/**
 * Set lists ("tonight's set"): an ordered list of songs from one deck.
 *
 * Songs are saved by title (and number when the deck has one), not by slide
 * position, so editing or reordering the deck doesn't break a saved set.
 */

import { normalize, type SongEntry } from "@/lib/songs";
import type { Slide } from "@/lib/types";

export type SetSong = { title: string; number?: string };

export type SetList = {
  id: string;
  name: string;
  songs: SetSong[];
  created_at: string;
  updated_at: string;
};

/** What get_shared_set returns to a share-link holder. */
export type SharedSet = SetList & {
  deck_title: string;
  slides: { title: string | null; body: string | null; table: string[][] | null; number: string | null; first_line: string | null }[];
};

/** The three newest sets per deck are kept (the database removes older ones). */
export const SETS_KEPT = 3;

export function toSetSong(song: SongEntry): SetSong {
  return song.number ? { title: song.title, number: song.number } : { title: song.title };
}

/** Finds the deck song a set entry refers to: same title (and number, when both have one). */
export function resolveSetSong(songs: SongEntry[], item: SetSong): SongEntry | undefined {
  const t = normalize(item.title);
  const sameTitle = songs.filter((s) => s.key.title === t);
  if (item.number) {
    const exact = sameTitle.find((s) => s.number === item.number);
    if (exact) return exact;
  }
  if (sameTitle.length) return sameTitle[0];
  // The title changed but the number is the same.
  return item.number ? songs.find((s) => s.number === item.number) : undefined;
}

export function sameSong(a: SongEntry | undefined, b: SongEntry | undefined) {
  return !!a && !!b && a.index === b.index;
}

/** Rebuilds slides and the matching notes lines from a shared set, for buildSongIndex. */
export function sharedSlides(shared: SharedSet) {
  const slides: Pick<Slide, "kind" | "content">[] = shared.slides.map((s) => ({
    kind: "built",
    content: { title: s.title ?? undefined, body: s.body ?? undefined, table: s.table ?? undefined },
  }));
  const notes = shared.slides.map((s) =>
    [s.number ? `Number: ${s.number}` : "", s.first_line ? `First line: ${s.first_line}` : ""].filter(Boolean).join("\n"),
  );
  return { slides, notes };
}

export function defaultSetName(d = new Date()) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function newShareKey() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The edit link for other leaders. The key sits after # so it is never sent to the server in requests or logs. */
export function shareUrl(id: string, key: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/sets/${id}#k=${key}`;
}

export function songsLabel(n: number) {
  return `${n} song${n === 1 ? "" : "s"}`;
}
