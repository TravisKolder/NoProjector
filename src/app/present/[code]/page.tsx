"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CopyLinkButton from "@/components/CopyLinkButton";
import QrModal from "@/components/QrModal";
import SetStrip from "@/components/SetStrip";
import SlideView from "@/components/SlideView";
import SongPicker from "@/components/SongPicker";
import { clearPresenterToken, getDevice, getPref, getPresenterToken, setPref, setPresenterToken } from "@/lib/device";
import { resolveSetSong, toSetSong, type SetList } from "@/lib/setLists";
import { buildSongIndex, songAt, type SongEntry } from "@/lib/songs";
import type { PresenceMember } from "@/lib/types";
import { useLiveSession, useWakeLock } from "@/lib/useLiveSession";
import { displayNameFor, useUser } from "@/lib/useUser";

type Role = "checking" | "presenter" | "not-presenter";
type Modal = null | "qr" | "handoff" | "end" | "songs";

export default function PresenterPage() {
  const params = useParams<{ code: string }>();
  const code = params.code.toUpperCase();
  const router = useRouter();
  const { user } = useUser();

  const [mounted, setMounted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("checking");
  const [light, setLight] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [localIdx, setLocalIdx] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<number[]>([]);
  const inFlight = useRef(0);
  const [sets, setSets] = useState<SetList[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [pos, setPos] = useState(-1);
  const [addToSet, setAddToSet] = useState(true);
  // Set chosen with "Present" on a set: open on its first song once everything has loaded.
  const startWithSet = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setToken(getPresenterToken(code));
    setLight(getPref("light") === "1");
    const fromLink = new URLSearchParams(window.location.search).get("set");
    if (fromLink) {
      startWithSet.current = fromLink;
      setActiveSetId(fromLink);
      setPref(`set_${code}`, fromLink);
      history.replaceState(null, "", window.location.pathname);
    } else {
      setActiveSetId(getPref(`set_${code}`) || null);
    }
  }, [code]);

  const device = useMemo(() => (mounted ? getDevice() : null), [mounted]);
  const me: PresenceMember | null = useMemo(
    () =>
      device
        ? {
            clientId: device.clientId,
            name: displayNameFor(user),
            role: role === "presenter" ? "presenter" : "viewer",
          }
        : null,
    [device, user, role],
  );

  const { supabase, loadState, session, setSession, members, connected, reload, notifyAll } = useLiveSession(code, me);

  // Am I (still) the presenter? Checked on load and whenever control changes hands.
  const epoch = session?.presenter_epoch;
  useEffect(() => {
    if (!mounted || epoch === undefined) return;
    let cancelled = false;
    (async () => {
      if (!token) {
        setRole("not-presenter");
        return;
      }
      const { data } = await supabase.rpc("verify_presenter", { p_code: code, p_token: token });
      if (cancelled) return;
      if (data === true) setRole("presenter");
      else {
        clearPresenterToken(code);
        setToken(null);
        setRole("not-presenter");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, epoch, token, code, supabase]);

  // Speaker notes come from a presenter-only function.
  const slideCount = session?.slides.length ?? 0;
  useEffect(() => {
    if (role !== "presenter" || !token) return;
    supabase
      .rpc("get_presenter_notes", { p_code: code, p_token: token })
      .then(({ data }) => setNotes(Array.isArray(data) ? (data as string[]) : []));
  }, [role, token, code, slideCount, supabase]);

  // Follow the server's slide index except while my own changes are in flight.
  const serverIdx = session?.current_slide ?? 0;
  useEffect(() => {
    if (inFlight.current === 0) setLocalIdx(serverIdx);
  }, [serverIdx]);

  useWakeLock(role === "presenter" && session?.status === "live");

  // Song list, built from slide titles (and "Number:" / "First line:" notes when present).
  const deckSlides = session?.slides;
  const songs = useMemo(() => (deckSlides ? buildSongIndex(deckSlides, notes) : []), [deckSlides, notes]);
  const currentSong = songAt(songs, localIdx);
  const currentSongIndex = currentSong?.index;
  useEffect(() => {
    if (currentSongIndex === undefined) return;
    setRecent((r) => [currentSongIndex, ...r.filter((i) => i !== currentSongIndex)].slice(0, 12));
  }, [currentSongIndex]);

  // Set lists for this deck: readable by whoever is presenting.
  const loadSets = useCallback(async () => {
    if (role !== "presenter") return;
    const { data } = await supabase.rpc("get_session_sets", { p_code: code, p_token: token ?? "" });
    if (Array.isArray(data)) setSets(data as SetList[]);
  }, [role, supabase, code, token]);
  useEffect(() => {
    loadSets();
    const onVis = () => document.visibilityState === "visible" && loadSets();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadSets]);

  const activeSet = useMemo(() => sets.find((x) => x.id === activeSetId) ?? null, [sets, activeSetId]);
  const resolved = useMemo(() => (activeSet ? activeSet.songs.map((it) => resolveSetSong(songs, it)) : []), [activeSet, songs]);

  // Keep track of where we are in the set as songs change (by strip, ♪ Songs, or Back).
  useEffect(() => {
    if (currentSongIndex === undefined || !resolved.length) return;
    setPos((p) => {
      if (resolved[p]?.index === currentSongIndex) return p;
      const after = resolved.findIndex((x, i) => i > p && x?.index === currentSongIndex);
      if (after >= 0) return after;
      const any = resolved.findIndex((x) => x?.index === currentSongIndex);
      return any >= 0 ? any : p;
    });
  }, [currentSongIndex, resolved]);

  function chooseSet(id: string | null) {
    setActiveSetId(id);
    setPref(`set_${code}`, id ?? "");
    setPos(-1);
  }

  // With a set, Next stops on the last slide of a song; the presenter taps the next song.
  const lastIdx = (session?.slides.length ?? 0) - 1;
  const waiting =
    !!activeSet && songs.length > 0 && localIdx < lastIdx && songAt(songs, localIdx + 1)?.index !== currentSongIndex;

  const go = useCallback(
    async (target: number) => {
      if (!session || !token || role !== "presenter") return;
      const n = session.slides.length;
      if (target < 0 || target >= n) return;
      setLocalIdx(target);
      inFlight.current += 1;
      const { error } = await supabase.rpc("set_slide", { p_code: code, p_token: token, p_index: target });
      inFlight.current -= 1;
      if (error) {
        setActionError(error.message);
        reload();
      } else {
        setActionError(null);
        if (inFlight.current === 0) setSession((s) => (s ? { ...s, current_slide: target } : s));
      }
    },
    [session, token, role, supabase, code, reload, setSession],
  );

  // Keyboard and clicker support for laptops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || (e.target as HTMLElement)?.closest("input, textarea")) return;
      if ((e.key === "/" || e.key.toLowerCase() === "s") && songs.length && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setModal("songs");
        return;
      }
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        if (!waiting) go(localIdx + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        go(localIdx - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, localIdx, modal, songs.length, waiting]);

  // Opening a set from "Present": go to its first song.
  useEffect(() => {
    if (!startWithSet.current || role !== "presenter" || !activeSet || !songs.length) return;
    if (activeSet.id !== startWithSet.current) return;
    startWithSet.current = null;
    const first = resolved.findIndex(Boolean);
    if (first >= 0) {
      setPos(first);
      go(resolved[first]!.start);
    }
  }, [role, activeSet, songs.length, resolved, go]);

  function jumpInSet(i: number) {
    const song = resolved[i];
    if (!song) return;
    setPos(i);
    go(song.start);
  }

  async function addSongToSet(song: SongEntry) {
    if (!activeSet) return;
    const at = pos + 1;
    const next = [...activeSet.songs.slice(0, at), toSetSong(song), ...activeSet.songs.slice(at)];
    setSets((all) => all.map((x) => (x.id === activeSet.id ? { ...x, songs: next } : x)));
    setPos(at);
    const { error } = await supabase.rpc("save_session_set", {
      p_code: code,
      p_token: token ?? "",
      p_set: activeSet.id,
      p_songs: next,
    });
    if (error) setActionError("The song is showing, but it couldn't be added to the saved set.");
  }

  function pickSong(song: SongEntry) {
    setModal(null);
    if (activeSet) {
      const after = resolved.findIndex((x, i) => i > pos && x?.index === song.index);
      const found = after >= 0 ? after : resolved.findIndex((x) => x?.index === song.index);
      if (found >= 0) setPos(found);
      else if (addToSet) addSongToSet(song);
    }
    go(song.start);
  }

  function toggleLight() {
    setLight((v) => {
      setPref("light", v ? "0" : "1");
      return !v;
    });
  }

  async function offerHandoff(target: PresenceMember) {
    if (!token) return;
    setBusy(true);
    const { error } = await supabase.rpc("offer_handoff", {
      p_code: code,
      p_token: token,
      p_client_id: target.clientId,
    });
    setBusy(false);
    if (error) setActionError(error.message);
  }

  async function cancelHandoff() {
    if (!token) return;
    await supabase.rpc("cancel_handoff", { p_code: code, p_token: token });
  }

  async function endSession(keep: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc("end_session", { p_code: code, p_token: token ?? "", p_keep: keep });
    setBusy(false);
    if (error) return setActionError(error.message);
    await notifyAll();
    clearPresenterToken(code);
    setModal(null);
    reload();
  }

  async function reclaim() {
    setBusy(true);
    const { data, error } = await supabase.rpc("reclaim_session", {
      p_code: code,
      p_presenter_name: displayNameFor(user),
    });
    setBusy(false);
    if (error || !data) return setActionError(error?.message ?? "Could not take control");
    setPresenterToken(code, data as string);
    setToken(data as string);
    setRole("presenter");
  }

  // ───── Non-presenting states ─────

  if (loadState === "loading" || (loadState === "ready" && role === "checking")) {
    return <main className="center-screen subtle">Loading…</main>;
  }
  if (loadState === "missing" || loadState === "expired" || loadState === "error" || !session) {
    return (
      <main className="center-screen">
        <div className="card stack narrow" style={{ width: "100%" }}>
          <h1 style={{ fontSize: 22 }}>{loadState === "error" ? "Can't reach the server" : "Session not found"}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {loadState === "error" ? "Check your connection and try again." : `There's no live session with code ${code}.`}
          </p>
          <div className="row">
            {loadState === "error" ? (
              <button className="btn" onClick={reload}>
                Try again
              </button>
            ) : null}
            <Link className="btn btn-primary" href="/decks">
              Your decks
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (session.status === "ended") {
    return (
      <main className="center-screen">
        <div className="card stack narrow" style={{ width: "100%" }}>
          <h1 style={{ fontSize: 22 }}>Session ended</h1>
          <p className="muted" style={{ margin: 0 }}>
            {session.keep_after
              ? "Slides stay viewable at the link for 3 hours."
              : "Slides are no longer available to viewers."}
          </p>
          <Link className="btn btn-primary" href="/decks">
            Back to your decks
          </Link>
        </div>
      </main>
    );
  }

  if (role === "not-presenter") {
    return (
      <main className="center-screen">
        <div className="card stack narrow" style={{ width: "100%" }}>
          <h1 style={{ fontSize: 22 }}>{session.presenter_name} is presenting</h1>
          <p className="muted" style={{ margin: 0 }}>
            {session.is_owner
              ? "You started this session, so you can take control back at any time."
              : "You're not the presenter on this device."}
          </p>
          {actionError ? <p className="error">{actionError}</p> : null}
          <div className="row">
            <button className="btn" onClick={() => router.push(`/s/${code}`)}>
              Watch as a viewer
            </button>
            {session.is_owner ? (
              <button className="btn btn-primary" onClick={reclaim} disabled={busy}>
                Take control back
              </button>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  // ───── Presenting ─────

  const slides = session.slides;
  const idx = Math.min(localIdx, slides.length - 1);
  const viewers = members.filter((m) => m.role === "viewer" && m.clientId !== device?.clientId);
  const handoffTarget = session.handoff_to ? viewers.find((v) => v.clientId === session.handoff_to) : null;
  const atStart = idx <= 0;
  const atEnd = idx >= slides.length - 1;
  const nextIsNewSong = !atEnd && songs.length > 0 && songAt(songs, idx + 1)?.index !== currentSong?.index;
  const songProgress = currentSong ? `${idx - currentSong.start + 1}/${currentSong.end - currentSong.start + 1}` : "";
  const upNext = activeSet && pos + 1 < activeSet.songs.length ? resolved[pos + 1] : undefined;
  const strip =
    songs.length > 0 ? (
      <SetStrip
        sets={sets}
        active={activeSet}
        resolved={resolved}
        pos={pos}
        waiting={waiting}
        onChoose={chooseSet}
        onJump={jumpInSet}
      />
    ) : null;

  return (
    <main className="presenter">
      <header className="presenter-top">
        <span className="presenter-code" title="Join code">
          {code}
        </span>
        <span className="subtle row" style={{ gap: 6 }}>
          <span className={`dot${connected ? " ok" : ""}`} aria-hidden="true" />
          {viewers.length} watching
        </span>
        <span className="spacer" />
        {songs.length ? (
          <button className="btn btn-sm btn-primary btn-songs" onClick={() => setModal("songs")} title="Find a song (S)">
            ♪ Songs
          </button>
        ) : null}
        <button className="btn btn-sm" onClick={() => setModal("qr")}>
          Show QR
        </button>
        <CopyLinkButton code={code} />
        <button className="btn btn-sm" onClick={() => setModal("handoff")}>
          Hand off
        </button>
        <button className="btn btn-sm" onClick={toggleLight} aria-pressed={light}>
          {light ? "Full view" : "Lightweight"}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => setModal("end")}>
          End
        </button>
      </header>

      {actionError ? (
        <div className="banner" role="alert">
          {actionError}
        </div>
      ) : null}
      {session.handoff_to ? (
        <div className="banner">
          Waiting for {handoffTarget?.name ?? "them"} to accept control…{" "}
          <button className="btn btn-sm btn-ghost" onClick={cancelHandoff}>
            Cancel
          </button>
        </div>
      ) : null}

      {light ? (
        <section className={`light-mode${strip && (activeSet || sets.length) ? " with-set" : ""}`}>
          <div className="now stack" style={{ gap: 8, alignItems: "center" }}>
            {currentSong ? (
              <>
                <div className="now-song" style={{ maxWidth: "90vw", fontSize: 18 }}>
                  {currentSong.number ? `${currentSong.number}. ` : ""}
                  {currentSong.title}
                </div>
                <div className="subtle counter">Slide {songProgress} of this song</div>
                <button className="btn btn-primary btn-songs" style={{ minHeight: 48, fontSize: 18, width: "100%" }} onClick={() => setModal("songs")}>
                  ♪ Find a song
                </button>
              </>
            ) : (
              <>
                <div className="counter">
                  {idx + 1} / {slides.length}
                </div>
                <div className="subtle">{slides[idx]?.content.title ?? ""}</div>
              </>
            )}
          </div>
          {strip}
          <button className="btn" onClick={() => go(idx - 1)} disabled={atStart}>
            ← Back
          </button>
          <button className="btn btn-primary" onClick={() => go(idx + 1)} disabled={atEnd || waiting}>
            {waiting ? "End of song" : "Next →"}
          </button>
        </section>
      ) : (
        <>
          <section className="presenter-main">
            <div className="stack">
              <SlideView slide={slides[idx]} theme={session.deck.theme} variant="preview" />
              <div className="row subtle">
                {currentSong ? (
                  <>
                    <span className="now-song" title={currentSong.title}>
                      {currentSong.number ? `${currentSong.number}. ` : ""}
                      {currentSong.title}
                    </span>
                    <span className="counter">{songProgress}</span>
                    <span className="spacer" />
                    <span className="counter">
                      Slide {idx + 1} of {slides.length}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="counter">
                      Slide {idx + 1} of {slides.length}
                    </span>
                    <span className="spacer" />
                    <span>{session.deck.title}</span>
                  </>
                )}
              </div>
            </div>
            <div className="stack">
              <div>
                <div className="next-label">
                  {atEnd
                    ? "Last slide"
                    : waiting
                      ? upNext
                        ? `End of song. Next in the set: ${upNext.title} (tap it below)`
                        : "End of song"
                      : nextIsNewSong
                        ? `Next: new song (${songAt(songs, idx + 1)?.title ?? ""})`
                        : "Next"}
                </div>
                {atEnd ? (
                  <div className="card subtle">End of deck</div>
                ) : waiting ? (
                  upNext ? (
                    <SlideView slide={slides[upNext.start]} theme={session.deck.theme} variant="preview" />
                  ) : (
                    <div className="card subtle">End of the set. Pick any song with ♪ Songs.</div>
                  )
                ) : (
                  <SlideView slide={slides[idx + 1]} theme={session.deck.theme} variant="preview" />
                )}
              </div>
              {notes[idx] ? (
                <div>
                  <div className="next-label">Notes</div>
                  <div className="notes">{notes[idx]}</div>
                </div>
              ) : null}
            </div>
          </section>
          <div className="presenter-dock">
            {strip}
            <nav className="presenter-controls">
              <button className="btn" onClick={() => go(idx - 1)} disabled={atStart}>
                ← Back
              </button>
              <button className="btn btn-primary" onClick={() => go(idx + 1)} disabled={atEnd || waiting}>
                {waiting ? "End of song" : "Next →"}
              </button>
            </nav>
          </div>
        </>
      )}

      {modal === "qr" ? <QrModal code={code} onClose={() => setModal(null)} /> : null}

      {modal === "songs" ? (
        <SongPicker
          songs={songs}
          current={currentSong}
          recent={recent}
          onPick={pickSong}
          onClose={() => setModal(null)}
          addToSet={
            activeSet ? { name: activeSet.name || "this set", checked: addToSet, onChange: setAddToSet } : undefined
          }
        />
      ) : null}

      {modal === "handoff" ? (
        <div className="overlay" onClick={() => setModal(null)} role="dialog" aria-modal="true">
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h3>Hand off control</h3>
            <p className="muted" style={{ margin: 0 }}>
              Pick anyone in the room. They&apos;ll get a prompt on their phone, and slides keep showing for everyone
              else.
              {session.is_owner ? " You can take control back at any time." : ""}
            </p>
            {viewers.length === 0 ? (
              <p className="subtle">No one has joined yet.</p>
            ) : (
              <ul className="people">
                {viewers.map((v) => (
                  <li key={v.clientId}>
                    <span>{v.name}</span>
                    {session.handoff_to === v.clientId ? (
                      <span className="subtle">Waiting…</span>
                    ) : (
                      <button className="btn btn-sm" onClick={() => offerHandoff(v)} disabled={busy}>
                        Hand off
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <button className="btn btn-primary" onClick={() => setModal(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {modal === "end" ? (
        <div className="overlay" onClick={() => setModal(null)} role="dialog" aria-modal="true">
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h3>End session?</h3>
            <p className="muted" style={{ margin: 0 }}>
              Choose what viewers can see afterward.
            </p>
            <button className="btn btn-primary btn-block" onClick={() => endSession(true)} disabled={busy}>
              End, keep slides viewable for 3 hours
            </button>
            <button className="btn btn-block" onClick={() => endSession(false)} disabled={busy}>
              End and close slides now
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setModal(null)}>
              Keep presenting
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
