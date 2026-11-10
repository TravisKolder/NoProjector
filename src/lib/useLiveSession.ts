"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { GetSessionResult, GetSessionStateResult, PresenceMember, SessionState } from "@/lib/types";

type LoadState = "loading" | "ready" | "expired" | "missing" | "error";

function preloadImages(session: SessionState) {
  for (const s of session.slides) {
    if (s.content.imageUrl) {
      const img = new Image();
      img.decoding = "async";
      img.src = s.content.imageUrl;
    }
  }
}

/**
 * Loads a session's slides once (all up front, so a dropped connection never blanks the screen),
 * then follows it live with small state checks: the database broadcasts "refresh" on every
 * change (slide, handoff, end) and each phone re-reads the state;
 * presence gives the viewer list. Reconnects, wake-ups, and refresh broadcasts re-read only the
 * small state (get_session_state). The full deck is fetched again only if the session changed
 * or its slide count no longer matches what's in memory.
 */
export function useLiveSession(code: string, me: PresenceMember | null) {
  const supabase = useMemo(() => createClient(), []);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const meRef = useRef(me);
  meRef.current = me;
  const preloadedFor = useRef<string | null>(null);
  const sessionRef = useRef<SessionState | null>(null);
  sessionRef.current = session;

  /** Full load: session state plus every slide. */
  const loadFull = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("get_session", { p_code: code });
    if (rpcError) {
      // Keep showing what we have; this is usually a dropped connection.
      setError(rpcError.message);
      setLoadState((s) => (s === "loading" ? "error" : s));
      return;
    }
    setError(null);
    const result = data as GetSessionResult;
    if (!result) {
      setLoadState("missing");
      return;
    }
    if ("expired" in result) {
      setLoadState("expired");
      return;
    }
    setSession(result);
    setLoadState("ready");
    if (preloadedFor.current !== result.id) {
      preloadedFor.current = result.id;
      preloadImages(result);
    }
  }, [code, supabase]);

  /** Small refresh: session state only, merged into the slides already in memory. */
  const refreshState = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return loadFull();
    const { data, error: rpcError } = await supabase.rpc("get_session_state", { p_code: code });
    if (rpcError) {
      setError(rpcError.message); // keep showing what we have
      return;
    }
    setError(null);
    const result = data as GetSessionStateResult;
    if (!result) {
      setLoadState("missing");
      return;
    }
    if ("expired" in result) {
      setLoadState("expired");
      return;
    }
    if (result.id !== current.id || result.slide_count !== current.slides.length) return loadFull();
    setSession((prev) => (prev && prev.id === result.id ? { ...prev, ...result } : prev));
    setLoadState("ready");
  }, [code, supabase, loadFull]);

  /** What callers use: a full load the first time, a small state refresh after that. */
  const reload = refreshState;

  useEffect(() => {
    loadFull();
  }, [loadFull]);

  const sessionId = session?.id;
  const hasMe = me !== null;

  useEffect(() => {
    if (!sessionId || !hasMe) return;
    const channel = supabase.channel(`np:${code.toUpperCase()}`, {
      config: { presence: { key: meRef.current!.clientId } },
    });

    // The database sends an empty "refresh" broadcast on this channel whenever the session
    // changes (slide, handoff, end). Each phone then reads the small state; an ended session
    // comes back as status "ended" (kept for 3 hours) or as expired (closed now).
    channel
      .on("broadcast", { event: "refresh" }, () => {
        reload();
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceMember>();
        const list: PresenceMember[] = [];
        for (const metas of Object.values(state)) {
          const m = metas[0];
          if (m) list.push({ clientId: m.clientId, name: m.name, role: m.role });
        }
        setMembers(list);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          if (meRef.current) await channel.track(meRef.current);
          reload(); // catch up on anything missed while connecting
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnected(false);
        }
      });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [code, sessionId, hasMe, reload, supabase]);

  // Re-announce if my name or role changes.
  const meKey = me ? `${me.clientId}|${me.name}|${me.role}` : "";
  useEffect(() => {
    if (me && connected && channelRef.current) channelRef.current.track(me);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meKey, connected]);

  // Resync when the phone wakes up or the network comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("online", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  /** Tell every device to re-read the session (used when a session ends). */
  const notifyAll = useCallback(async () => {
    await channelRef.current?.send({ type: "broadcast", event: "refresh", payload: {} });
  }, []);

  return { supabase, loadState, session, setSession, error, connected, members, reload, notifyAll };
}

/** Keeps the screen on while `active`, re-acquiring after the tab is hidden and shown again. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Not allowed right now (e.g. low battery); harmless.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
