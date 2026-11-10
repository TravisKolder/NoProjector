"use client";

import { useEffect, useRef } from "react";
import type { SongEntry } from "@/lib/songs";
import { songsLabel, type SetList } from "@/lib/setLists";

type Props = {
  sets: SetList[];
  active: SetList | null;
  /** The deck song each set entry points to (undefined when it's no longer in the deck). */
  resolved: (SongEntry | undefined)[];
  /** Position in the set of the song showing now, or -1. */
  pos: number;
  /** True on a song's last slide: the presenter picks the next song here. */
  waiting: boolean;
  onChoose: (setId: string | null) => void;
  onJump: (i: number) => void;
};

/** The presenter's set list: tap a song to jump every phone to it. */
export default function SetStrip({ sets, active, resolved, pos, waiting, onChoose, onJump }: Props) {
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(".set-chip.next") ?? list.current?.querySelector<HTMLElement>(".set-chip.now");
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [pos, active?.id]);

  if (!active) {
    if (!sets.length) return null;
    return (
      <div className="set-strip" role="navigation" aria-label="Set lists">
        <div className="set-strip-head">
          <strong>Present from a set</strong>
        </div>
        <ol className="set-strip-list">
          {sets.map((s) => (
            <li key={s.id}>
              <button className="set-chip" onClick={() => onChoose(s.id)}>
                <span>
                  {s.name || "Untitled set"} · {songsLabel(s.songs.length)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const n = active.songs.length;
  return (
    <div className="set-strip" role="navigation" aria-label={`Set: ${active.name || "Untitled set"}`}>
      <div className="set-strip-head">
        <strong>{active.name || "Untitled set"}</strong>
        <span className="subtle">{pos >= 0 ? `Song ${pos + 1} of ${n}` : songsLabel(n)}</span>
        {waiting ? (
          <span className="song-tag">{pos + 1 < n ? "End of song: tap the next one" : "End of the set"}</span>
        ) : null}
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => onChoose(null)}>
          Stop using set
        </button>
      </div>
      {n === 0 ? (
        <p className="subtle" style={{ margin: 0 }}>
          This set is empty. Pick songs with ♪ Songs.
        </p>
      ) : (
        <ol className="set-strip-list" ref={list}>
          {active.songs.map((item, i) => {
            const song = resolved[i];
            const cls = [
              "set-chip",
              i < pos ? "played" : "",
              i === pos ? "now" : "",
              i === pos + 1 ? "next" : "",
              i === pos + 1 && waiting ? "waiting" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={`${i}-${item.title}`}>
                <button
                  className={cls}
                  onClick={() => onJump(i)}
                  disabled={!song}
                  aria-current={i === pos ? "true" : undefined}
                  title={song ? item.title : `${item.title} (not in the deck anymore)`}
                >
                  <span className="set-n">{i + 1}</span>
                  <span>{item.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
