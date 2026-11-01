"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "@/components/Brand";
import SlideView from "@/components/SlideView";
import { useUser } from "@/lib/useUser";
import type { Slide, ThemeId } from "@/lib/types";

type DeckRow = {
  id: string;
  title: string;
  theme: ThemeId;
  updated_at: string;
  slides: { id: string; kind: Slide["kind"]; content: Slide["content"]; position: number }[];
};

type LiveRow = { code: string; deck_id: string; expires_at: string };

export default function DecksPage() {
  const router = useRouter();
  const { supabase, user } = useUser();
  const [decks, setDecks] = useState<DeckRow[] | null>(null);
  const [live, setLive] = useState<LiveRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [d, s] = await Promise.all([
        supabase
          .from("decks")
          .select("id, title, theme, updated_at, slides(id, kind, content, position)")
          .order("updated_at", { ascending: false }),
        supabase
          .from("sessions")
          .select("code, deck_id, expires_at")
          .eq("owner_id", user.id)
          .eq("status", "live")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false }),
      ]);
      if (d.error) setError(d.error.message);
      setDecks((d.data as DeckRow[]) ?? []);
      setLive((s.data as LiveRow[]) ?? []);
    })();
  }, [user, supabase]);

  async function newDeck() {
    setBusy(true);
    const { data, error } = await supabase.from("decks").insert({ title: "Untitled deck" }).select("id").single();
    if (error || !data) {
      setError(error?.message ?? "Could not create deck");
      setBusy(false);
      return;
    }
    await supabase.from("slides").insert({ deck_id: data.id, position: 0, content: { title: "Welcome" } });
    router.push(`/decks/${data.id}`);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (!user) return <main className="center-screen subtle">Loading…</main>;

  return (
    <main className="page">
      <div className="topbar">
        <Brand />
        <div className="row">
          <span className="subtle">{user.email}</span>
          <button className="btn btn-sm btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {live.length > 0 ? (
        <div className="card stack" style={{ marginBottom: 20 }}>
          <span className="live-pill">Live now</span>
          {live.map((s) => {
            const deck = decks?.find((d) => d.id === s.deck_id);
            return (
              <div key={s.code} className="row">
                <strong>{deck?.title ?? "Deck"}</strong>
                <span className="subtle">Code {s.code}</span>
                <span className="spacer" />
                <Link className="btn btn-sm" href={`/present/${s.code}`}>
                  Resume
                </Link>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24 }}>Your decks</h1>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={newDeck} disabled={busy}>
          New deck
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      {decks === null ? (
        <p className="subtle">Loading…</p>
      ) : decks.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No decks yet. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="deck-grid">
          {decks.map((d) => {
            const first = [...d.slides].sort((a, b) => a.position - b.position)[0];
            return (
              <Link key={d.id} href={`/decks/${d.id}`} className="deck-card">
                <SlideView slide={first} theme={d.theme} variant="preview" />
                <div>
                  <strong>{d.title}</strong>
                  <div className="subtle">
                    {d.slides.length} slide{d.slides.length === 1 ? "" : "s"}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
