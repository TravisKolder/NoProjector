"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { searchSongs, type SongEntry } from "@/lib/songs";

type Props = {
  songs: SongEntry[];
  current?: SongEntry;
  /** Song indexes used earlier this session, most recent first. */
  recent?: number[];
  onPick: (song: SongEntry) => void;
  onClose: () => void;
};

const WHY_LABEL = { number: "", title: "", "first line": "", lyrics: "in lyrics" } as const;

export default function SongPicker({ songs, current, recent = [], onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    // Phones: focusing right away can scroll oddly before the panel is laid out.
    const t = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const results = useMemo(() => searchSongs(songs, query), [songs, query]);
  const recentSongs = useMemo(
    () =>
      recent
        .map((i) => songs[i])
        .filter((s): s is SongEntry => !!s && s.index !== current?.index)
        .slice(0, 5),
    [recent, songs, current],
  );
  const showRecent = !query.trim() && recentSongs.length > 0;

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active]?.song;
      if (pick) onPick(pick);
    }
  }

  const row = (song: SongEntry, i: number | null, note?: string) => (
    <li key={`${i ?? "r"}-${song.index}`}>
      <button
        type="button"
        className={`song-row${i !== null && i === active ? " active" : ""}${current?.index === song.index ? " current" : ""}`}
        data-i={i ?? undefined}
        onClick={() => onPick(song)}
        onMouseEnter={() => i !== null && setActive(i)}
      >
        <span className="song-num">{song.number ?? song.index + 1}</span>
        <span className="song-text">
          <span className="song-title">{song.title}</span>
          {song.firstLine && song.firstLine !== song.title ? <span className="song-first">{song.firstLine}</span> : null}
        </span>
        {current?.index === song.index ? <span className="song-tag">Now</span> : note ? <span className="song-tag muted-tag">{note}</span> : null}
      </button>
    </li>
  );

  return (
    <div className="overlay song-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Songs">
      <div className="modal song-panel" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="row" style={{ gap: 8 }}>
          <input
            ref={input}
            className="input song-search"
            type="search"
            inputMode="search"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Song, number, or words"
            aria-label="Search songs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <ul className="song-list" ref={list}>
          {showRecent ? (
            <>
              <li className="song-section">Used tonight</li>
              {recentSongs.map((s) => row(s, null))}
              <li className="song-section">All songs ({songs.length})</li>
            </>
          ) : null}
          {results.map((m, i) => row(m.song, i, WHY_LABEL[m.why] || undefined))}
          {!results.length ? <li className="song-empty">No songs match “{query}”.</li> : null}
        </ul>
      </div>
    </div>
  );
}
