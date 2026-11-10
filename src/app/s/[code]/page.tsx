"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Brand from "@/components/Brand";
import { ViewerSkeleton } from "@/components/Skeletons";
import SlideView from "@/components/SlideView";
import { getDevice, getName, getPref, setName, setPref, setPresenterToken } from "@/lib/device";
import type { PresenceMember } from "@/lib/types";
import { useLiveSession, useWakeLock } from "@/lib/useLiveSession";

type Mode = "deck" | "light" | "dark";
const MODES: Mode[] = ["deck", "light", "dark"];
const MODE_LABEL: Record<Mode, string> = { deck: "Deck colors", light: "Light", dark: "Dark" };
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.85;

export default function ViewerPage() {
  const params = useParams<{ code: string }>();
  const code = params.code.toUpperCase();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [scale, setScale] = useState(1);
  const [mode, setMode] = useState<Mode>("deck");
  const [browseIdx, setBrowseIdx] = useState<number | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setNameInput(getName());
    const s = parseFloat(getPref("scale") ?? "1");
    if (!Number.isNaN(s)) setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)));
    const m = getPref("mode") as Mode | null;
    if (m && MODES.includes(m)) setMode(m);
  }, []);

  const device = useMemo(() => (mounted ? getDevice() : null), [mounted]);
  const me: PresenceMember | null = useMemo(
    () => (joined && device ? { clientId: device.clientId, name: nameInput.trim() || "Guest", role: "viewer" } : null),
    // Name is fixed once joined.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [joined, device],
  );

  const { supabase, loadState, session, connected, reload } = useLiveSession(code, me);
  const isLive = session?.status === "live";
  useWakeLock(joined && isLive);

  async function join(e?: React.FormEvent) {
    e?.preventDefault();
    if (!device) return;
    const name = nameInput.trim();
    setName(name);
    setJoined(true);
    // Registration only matters for being handed control; watching works without it.
    const args = { p_code: code, p_client_id: device.clientId, p_secret: device.secret, p_name: name || "Guest" };
    let { error } = await supabase.rpc("register_viewer", args);
    if (error) {
      await new Promise((r) => setTimeout(r, 1000));
      ({ error } = await supabase.rpc("register_viewer", args));
    }
    if (error) console.warn("No Projector: couldn't register this device for handoff:", error.message);
  }

  function changeScale(delta: number) {
    setScale((s) => {
      const next = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta)) * 100) / 100;
      setPref("scale", String(next));
      return next;
    });
  }

  function cycleMode() {
    setMode((m) => {
      const next = MODES[(MODES.indexOf(m) + 1) % MODES.length];
      setPref("mode", next);
      return next;
    });
  }

  async function acceptHandoff() {
    if (!device) return;
    setHandoffBusy(true);
    setHandoffError(null);
    const { data, error } = await supabase.rpc("claim_handoff", {
      p_code: code,
      p_client_id: device.clientId,
      p_secret: device.secret,
    });
    setHandoffBusy(false);
    if (error || !data) {
      setHandoffError(error?.message ?? "That handoff is no longer available");
      reload();
      return;
    }
    setPresenterToken(code, data as string);
    router.push(`/present/${code}`);
  }

  async function declineHandoff() {
    if (!device) return;
    await supabase.rpc("decline_handoff", { p_code: code, p_client_id: device.clientId, p_secret: device.secret });
  }

  // ───── Before the slides ─────

  if (!mounted || loadState === "loading") {
    return <ViewerSkeleton />;
  }

  if (loadState !== "ready" || !session) {
    const title =
      loadState === "expired" ? "This session has ended" : loadState === "error" ? "Can't connect" : "Code not found";
    const text =
      loadState === "expired"
        ? "The presenter has closed these slides."
        : loadState === "error"
          ? "Check your signal or Wi-Fi, then try again."
          : `No session uses the code ${code}. Check it with the presenter.`;
    return (
      <main className="center-screen">
        <div className="card stack narrow" style={{ width: "100%" }}>
          <Brand />
          <h1 style={{ fontSize: 22 }}>{title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {text}
          </p>
          <div className="row">
            {loadState === "error" ? (
              <button className="btn btn-primary" onClick={reload}>
                Try again
              </button>
            ) : (
              <Link className="btn" href="/">
                Enter a different code
              </Link>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (!joined && isLive) {
    return (
      <main className="center-screen">
        <form className="card stack narrow" style={{ width: "100%" }} onSubmit={join}>
          <Brand />
          <h1 style={{ fontSize: 22 }}>{session.deck.title}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {session.presenter_name} is presenting. Slides will change on your screen as they go.
          </p>
          <div>
            <label className="label" htmlFor="name">
              Your name <span className="subtle">(optional, so the presenter can hand you control)</span>
            </label>
            <input
              id="name"
              className="input"
              autoComplete="given-name"
              maxLength={40}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-block">Join</button>
        </form>
      </main>
    );
  }

  // ───── Slides ─────

  const slides = session.slides;
  const browsing = !isLive; // ended but kept viewable: free browsing
  const idx = Math.max(0, Math.min(browsing ? (browseIdx ?? session.current_slide) : session.current_slide, slides.length - 1));
  const offered = isLive && device && session.handoff_to === device.clientId;
  const keptUntil =
    browsing && session.ended_at
      ? new Date(new Date(session.ended_at).getTime() + 3 * 3600_000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  return (
    <main className="viewer">
      {browsing ? (
        <div className="banner">Session ended. Slides are available until {keptUntil}.</div>
      ) : !connected ? (
        <div className="banner">Reconnecting… your slides are saved on this phone.</div>
      ) : null}

      <div className="viewer-stage">
        <SlideView slide={slides[idx]} theme={session.deck.theme} variant="full" scale={scale} mode={mode} />
      </div>

      <div className="viewer-bar">
        <span className={`dot${connected || browsing ? " ok" : ""}`} aria-label={connected ? "Connected" : "Reconnecting"} />
        {browsing ? (
          <>
            <button className="btn" onClick={() => setBrowseIdx(Math.max(0, idx - 1))} disabled={idx === 0} aria-label="Previous slide">
              ←
            </button>
            <span className="counter">
              {idx + 1}/{slides.length}
            </span>
            <button
              className="btn"
              onClick={() => setBrowseIdx(Math.min(slides.length - 1, idx + 1))}
              disabled={idx === slides.length - 1}
              aria-label="Next slide"
            >
              →
            </button>
          </>
        ) : (
          <span className="counter">
            {idx + 1}/{slides.length}
          </span>
        )}
        <span className="spacer" />
        <button className="btn" onClick={() => changeScale(-0.15)} disabled={scale <= MIN_SCALE} aria-label="Smaller text">
          A−
        </button>
        <button className="btn" onClick={() => changeScale(0.15)} disabled={scale >= MAX_SCALE} aria-label="Larger text">
          A+
        </button>
        <button className="btn" onClick={cycleMode} aria-label={`Colors: ${MODE_LABEL[mode]}`}>
          {MODE_LABEL[mode]}
        </button>
      </div>

      {offered ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal stack">
            <h3>Take over presenting?</h3>
            <p className="muted" style={{ margin: 0 }}>
              {session.handoff_from ?? "The presenter"} wants to hand you control. You&apos;ll advance the slides for
              everyone.
            </p>
            {handoffError ? <p className="error">{handoffError}</p> : null}
            <button className="btn btn-primary btn-block" onClick={acceptHandoff} disabled={handoffBusy}>
              {handoffBusy ? "Taking over…" : "Yes, I'll present"}
            </button>
            <button className="btn btn-block" onClick={declineHandoff} disabled={handoffBusy}>
              No thanks
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
