"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Brand from "@/components/Brand";
import { copyText } from "@/components/CopyLinkButton";
import { buildSongIndex, searchSongs, type SongEntry } from "@/lib/songs";
import {
  newShareKey,
  resolveSetSong,
  shareUrl,
  sharedSlides,
  songsLabel,
  toSetSong,
  type SetSong,
  type SharedSet,
} from "@/lib/setLists";
import { presentSetPath, startSession } from "@/lib/startSession";
import { displayNameFor, useUser } from "@/lib/useUser";

type Load = "loading" | "ready" | "bad-link";
type Save = "saved" | "saving" | "unsaved" | "error";

function keyFromHash() {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/k=([0-9a-f]{32,})/i);
  return m ? m[1] : null;
}

export default function SetEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { supabase, user } = useUser();

  const [key, setKey] = useState<string | null>(null);
  const [owner, setOwner] = useState<{ deckId: string } | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [shared, setShared] = useState<SharedSet | null>(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState<SetSong[]>([]);
  const [save, setSave] = useState<Save>("saved");
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<number | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The key comes from the link (#k=…). The deck owner can open the set without it.
  useEffect(() => {
    if (user === undefined) return;
    let cancelled = false;
    (async () => {
      let k = keyFromHash();
      if (user) {
        const { data } = await supabase.from("set_lists").select("deck_id, share_key").eq("id", id).maybeSingle();
        if (cancelled) return;
        if (data) {
          setOwner({ deckId: data.deck_id as string });
          k = data.share_key as string;
        }
      }
      if (!k) setLoad("bad-link");
      setKey(k);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, supabase, id]);

  const fetchSet = useCallback(async () => {
    if (!key) return;
    const { data, error } = await supabase.rpc("get_shared_set", { p_set: id, p_key: key });
    if (error) return setError("Can't reach the server. Check your connection.");
    if (!data) return setLoad("bad-link");
    const s = data as SharedSet;
    setShared(s);
    if (!dirty.current) {
      setName(s.name);
      setItems(s.songs);
    }
    setError(null);
    setLoad("ready");
  }, [key, supabase, id]);

  useEffect(() => {
    fetchSet();
  }, [fetchSet]);

  // Another leader may have changed the set: refresh when coming back to the tab.
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && !dirty.current && fetchSet();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchSet]);

  const songs = useMemo(() => {
    if (!shared) return [];
    const { slides, notes } = sharedSlides(shared);
    return buildSongIndex(slides, notes);
  }, [shared]);
  const results = useMemo(() => searchSongs(songs, query), [songs, query]);
  const resolved = useMemo(() => items.map((it) => resolveSetSong(songs, it)), [items, songs]);
  const inSet = useMemo(() => {
    const m = new Map<number, number>();
    resolved.forEach((s, i) => s && !m.has(s.index) && m.set(s.index, i));
    return m;
  }, [resolved]);

  // Autosave shortly after each change.
  const doSave = useCallback(
    async (nextName: string, nextItems: SetSong[]) => {
      if (!key) return;
      setSave("saving");
      const { data, error } = await supabase.rpc("save_shared_set", {
        p_set: id,
        p_key: key,
        p_name: nextName,
        p_songs: nextItems,
      });
      if (error || !data) {
        setSave("error");
        return;
      }
      dirty.current = false;
      setSave("saved");
    },
    [key, supabase, id],
  );

  function change(nextName: string, nextItems: SetSong[]) {
    setName(nextName);
    setItems(nextItems);
    dirty.current = true;
    setSave("unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(nextName, nextItems), 600);
  }

  // Don't lose a pending save when leaving the page.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  function add(song: SongEntry) {
    if (items.length >= 100) return setError("A set can hold up to 100 songs.");
    change(name, [...items, toSetSong(song)]);
    setFlash(song.index);
    setTimeout(() => setFlash((f) => (f === song.index ? null : f)), 1200);
  }

  function move(i: number, by: -1 | 1) {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    change(name, next);
  }

  function remove(i: number) {
    change(
      name,
      items.filter((_, k) => k !== i),
    );
  }

  async function copyLink() {
    if (!key) return;
    const ok = await copyText(shareUrl(id, key));
    setCopied(ok ? "copied" : "failed");
    setTimeout(() => setCopied("idle"), 1800);
  }

  async function resetLink() {
    if (!owner || !confirm("Make a new edit link? Anyone using the old link won't be able to open this set anymore.")) return;
    const k = newShareKey();
    const { error } = await supabase.from("set_lists").update({ share_key: k }).eq("id", id);
    if (error) return setError(error.message);
    setKey(k);
    if (window.location.hash) history.replaceState(null, "", `${window.location.pathname}#k=${k}`);
    setCopied("idle");
  }

  async function present() {
    if (!owner) return;
    setBusy(true);
    if (dirty.current) await doSave(name, items);
    try {
      const code = await startSession(supabase, owner.deckId, displayNameFor(user));
      router.push(presentSetPath(code, id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (load === "loading") {
    return (
      <main className="page" aria-busy="true">
        <div className="topbar">
          <Brand />
        </div>
        <p className="subtle">Loading set…</p>
      </main>
    );
  }

  if (load === "bad-link" || !shared) {
    return (
      <main className="center-screen">
        <div className="card stack narrow" style={{ width: "100%" }}>
          <h1 style={{ fontSize: 22 }}>This set link doesn&apos;t work</h1>
          <p className="muted" style={{ margin: 0 }}>
            The link may have been replaced with a new one, or the set was removed. Only the three newest sets for a deck
            are kept. Ask whoever sent it for a fresh link.
          </p>
          <Link className="btn btn-primary" href={user ? "/decks" : "/"}>
            {user ? "Your decks" : "Home"}
          </Link>
        </div>
      </main>
    );
  }

  const saveLabel =
    save === "saving" ? "Saving…" : save === "unsaved" ? "Unsaved changes" : save === "error" ? "Couldn't save. Check your connection." : "All changes saved";

  return (
    <main className="page set-page">
      <div className="topbar">
        <Brand />
        {owner ? (
          <Link className="btn btn-sm" href="/decks">
            Your decks
          </Link>
        ) : null}
      </div>

      <div className="stack" style={{ gap: 6, marginBottom: 16 }}>
        <span className="subtle">Set list · {shared.deck_title}</span>
        <input
          className="input set-name"
          value={name}
          maxLength={80}
          placeholder="Name this set (for example, Sunday Nov 15)"
          aria-label="Set name"
          onChange={(e) => change(e.target.value, items)}
        />
        <span className={save === "error" ? "error" : "subtle"} aria-live="polite">
          {saveLabel}
          {save === "error" ? (
            <>
              {" "}
              <button className="btn btn-sm btn-ghost" onClick={() => doSave(name, items)}>
                Try again
              </button>
            </>
          ) : null}
        </span>
      </div>

      {owner ? (
        <div className="row" style={{ marginBottom: 16 }}>
          <button className="btn btn-primary" onClick={present} disabled={busy || items.length === 0}>
            {busy ? "Starting…" : "Present this set"}
          </button>
          <button className="btn" onClick={copyLink} aria-live="polite">
            {copied === "copied" ? "Link copied ✓" : copied === "failed" ? "Copy failed" : "Copy edit link"}
          </button>
          <button className="btn btn-ghost" onClick={resetLink}>
            New link
          </button>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          You&apos;re editing this set with a shared link. Changes save automatically.
        </p>
      )}
      {owner ? (
        <p className="subtle" style={{ marginTop: -8 }}>
          Send the edit link to another leader so they can change the set. Anyone with the link can edit it.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="set-editor">
        <section className="card set-card" aria-labelledby="set-title">
          <h2 id="set-title" className="set-h">
            Tonight&apos;s set <span className="subtle">({songsLabel(items.length)})</span>
          </h2>
          {items.length === 0 ? (
            <p className="subtle" style={{ margin: 0 }}>
              Nothing yet. Search for songs and tap one to add it.
            </p>
          ) : (
            <ol className="set-items">
              {items.map((it, i) => {
                const song = resolved[i];
                return (
                  <li key={`${i}-${it.title}`} className={`set-item${song ? "" : " missing"}`}>
                    <span className="song-num">{i + 1}</span>
                    <span className="song-text">
                      <span className="song-title">{it.title}</span>
                      <span className="song-first">
                        {song
                          ? [it.number ? `No. ${it.number}` : "", song.firstLine !== song.title ? song.firstLine : ""].filter(Boolean).join(" · ")
                          : "Not in the deck anymore"}
                      </span>
                    </span>
                    <span className="set-item-actions">
                      <button className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${it.title} up`}>
                        ↑
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => move(i, 1)}
                        disabled={i === items.length - 1}
                        aria-label={`Move ${it.title} down`}
                      >
                        ↓
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(i)} aria-label={`Remove ${it.title}`}>
                        ✕
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="card set-card" aria-labelledby="add-title">
          <h2 id="add-title" className="set-h">
            Add songs <span className="subtle">({songs.length} in the deck)</span>
          </h2>
          {songs.length === 0 ? (
            <p className="subtle" style={{ margin: 0 }}>
              This deck has no songs. A song is a run of slides that share the same title.
            </p>
          ) : (
            <>
              <input
                className="input song-search"
                type="search"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Song, number, or words"
                aria-label="Search songs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="song-list set-results">
                {results.map(({ song, why }) => {
                  const at = inSet.get(song.index);
                  return (
                    <li key={song.index}>
                      <button type="button" className="song-row" onClick={() => add(song)}>
                        <span className="song-num">{song.number ?? song.index + 1}</span>
                        <span className="song-text">
                          <span className="song-title">{song.title}</span>
                          {song.firstLine && song.firstLine !== song.title ? <span className="song-first">{song.firstLine}</span> : null}
                        </span>
                        {flash === song.index ? (
                          <span className="song-tag">Added ✓</span>
                        ) : at !== undefined ? (
                          <span className="song-tag muted-tag">In set (#{at + 1})</span>
                        ) : why === "lyrics" ? (
                          <span className="song-tag muted-tag">in lyrics</span>
                        ) : null}
                        <span className="set-add" aria-hidden="true">
                          +
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!results.length ? <li className="song-empty">No songs match “{query}”.</li> : null}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
