"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Brand from "@/components/Brand";
import { DeckGridSkeleton, DecksPageSkeleton } from "@/components/Skeletons";
import SlideView from "@/components/SlideView";
import { defaultSetName, songsLabel, SETS_KEPT, type SetList } from "@/lib/setLists";
import { buildSongIndex } from "@/lib/songs";
import { presentSetPath, startSession } from "@/lib/startSession";
import { displayNameFor, useUser } from "@/lib/useUser";
import type { Slide, ThemeId } from "@/lib/types";

type DeckRow = {
  id: string;
  title: string;
  theme: ThemeId;
  updated_at: string;
  slides: { id: string; kind: Slide["kind"]; content: Slide["content"]; position: number }[];
};

type LiveRow = { code: string; deck_id: string; expires_at: string };
type SetRow = SetList & { deck_id: string };

export default function DecksPage() {
  const router = useRouter();
  const { supabase, user } = useUser();
  const [decks, setDecks] = useState<DeckRow[] | null>(null);
  const [live, setLive] = useState<LiveRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sets, setSets] = useState<SetRow[]>([]);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [d, s, l] = await Promise.all([
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
        supabase
          .from("set_lists")
          .select("id, deck_id, name, songs, created_at, updated_at")
          .order("created_at", { ascending: false }),
      ]);
      if (d.error) setError(d.error.message);
      setDecks((d.data as DeckRow[]) ?? []);
      setLive((s.data as LiveRow[]) ?? []);
      setSets((l.data as SetRow[]) ?? []);
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

  // Decks made of songs (each song's slides share a title) get set lists.
  const songDecks = useMemo(
    () =>
      (decks ?? [])
        .map((d) => {
          const ordered = [...d.slides].sort((a, b) => a.position - b.position);
          const count = buildSongIndex(ordered, ordered.map((x) => x.content.notes)).length;
          return { deck: d, count };
        })
        .filter((x) => x.count > 0),
    [decks],
  );

  async function newSet(deckId: string) {
    setBusy(true);
    const { data, error } = await supabase
      .from("set_lists")
      .insert({ deck_id: deckId, name: defaultSetName() })
      .select("id")
      .single();
    if (error || !data) {
      setError(error?.message ?? "Could not create the set");
      setBusy(false);
      return;
    }
    router.push(`/sets/${data.id}`);
  }

  async function presentSet(deckId: string, setId: string) {
    setBusy(true);
    try {
      const code = await startSession(supabase, deckId, displayNameFor(user));
      router.push(presentSetPath(code, setId));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (!user) return <DecksPageSkeleton />;

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

      {songDecks.map(({ deck, count }) => {
        const deckSets = sets.filter((x) => x.deck_id === deck.id);
        return (
          <section key={deck.id} className="card stack sets-panel" aria-label={`Set lists for ${deck.title}`}>
            <div className="row">
              <div>
                <h2 className="set-h" style={{ margin: 0 }}>
                  Set lists
                </h2>
                <span className="subtle">
                  {deck.title} · {songsLabel(count)}
                </span>
              </div>
              <span className="spacer" />
              <button className="btn btn-sm" onClick={() => newSet(deck.id)} disabled={busy}>
                + New set
              </button>
            </div>
            {deckSets.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Plan what you&apos;ll sing: pick songs ahead of time, put them in order, and present straight from the list.
              </p>
            ) : (
              <ul className="sets-list">
                {deckSets.map((x) => (
                  <li key={x.id} className="sets-row">
                    <div className="sets-row-text">
                      <strong>{x.name || "Untitled set"}</strong>
                      <span className="subtle">
                        {songsLabel(x.songs.length)}
                        {x.songs.length ? ` · ${x.songs.slice(0, 3).map((s) => s.title).join(", ")}${x.songs.length > 3 ? "…" : ""}` : ""}
                      </span>
                    </div>
                    <div className="row">
                      <Link className="btn btn-sm" href={`/sets/${x.id}`}>
                        Edit
                      </Link>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => presentSet(deck.id, x.id)}
                        disabled={busy || x.songs.length === 0}
                      >
                        Present
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {deckSets.length >= SETS_KEPT ? (
              <span className="subtle">The {SETS_KEPT} newest sets are kept; a new set replaces the oldest.</span>
            ) : null}
          </section>
        );
      })}

      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24 }}>Your decks</h1>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={newDeck} disabled={busy}>
          New deck
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}

      {decks === null ? (
        <DeckGridSkeleton />
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
