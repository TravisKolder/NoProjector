"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CopyLinkButton from "@/components/CopyLinkButton";
import QrModal from "@/components/QrModal";
import SlideView from "@/components/SlideView";
import { clearPresenterToken, getDevice, getPref, getPresenterToken, setPref, setPresenterToken } from "@/lib/device";
import type { PresenceMember } from "@/lib/types";
import { useLiveSession, useWakeLock } from "@/lib/useLiveSession";
import { displayNameFor, useUser } from "@/lib/useUser";

type Role = "checking" | "presenter" | "not-presenter";
type Modal = null | "qr" | "handoff" | "end";

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
  const inFlight = useRef(0);

  useEffect(() => {
    setMounted(true);
    setToken(getPresenterToken(code));
    setLight(getPref("light") === "1");
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
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        go(localIdx + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        go(localIdx - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, localIdx, modal]);

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
        <section className="light-mode">
          <div className="now">
            <div className="counter">
              {idx + 1} / {slides.length}
            </div>
            <div className="subtle">{slides[idx]?.content.title ?? ""}</div>
          </div>
          <button className="btn" onClick={() => go(idx - 1)} disabled={atStart}>
            ← Back
          </button>
          <button className="btn btn-primary" onClick={() => go(idx + 1)} disabled={atEnd}>
            Next →
          </button>
        </section>
      ) : (
        <>
          <section className="presenter-main">
            <div className="stack">
              <SlideView slide={slides[idx]} theme={session.deck.theme} variant="preview" />
              <div className="row subtle">
                <span className="counter">
                  Slide {idx + 1} of {slides.length}
                </span>
                <span className="spacer" />
                <span>{session.deck.title}</span>
              </div>
            </div>
            <div className="stack">
              <div>
                <div className="next-label">{atEnd ? "Last slide" : "Next"}</div>
                {atEnd ? (
                  <div className="card subtle">End of deck</div>
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
          <nav className="presenter-controls">
            <button className="btn" onClick={() => go(idx - 1)} disabled={atStart}>
              ← Back
            </button>
            <button className="btn btn-primary" onClick={() => go(idx + 1)} disabled={atEnd}>
              Next →
            </button>
          </nav>
        </>
      )}

      {modal === "qr" ? <QrModal code={code} onClose={() => setModal(null)} /> : null}

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
