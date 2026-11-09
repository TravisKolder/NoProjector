/**
 * Builds a song list from a deck so presenters can jump straight to any song.
 *
 * A new song starts wherever the slide title changes (decks built to the
 * No Projector format repeat the song title on every slide). Speaker notes
 * written as "Number: 12" and "First line: …" are picked up when present.
 */

import type { Slide } from "@/lib/types";

export type SongEntry = {
  /** Position in the list, 0-based. */
  index: number;
  /** First and last slide (0-based, inclusive). */
  start: number;
  end: number;
  title: string;
  number?: string;
  firstLine?: string;
  /** Normalized text used for matching. */
  key: { title: string; firstLine: string; lyrics: string };
};

type SlideLike = Pick<Slide, "kind" | "content">;

export function normalize(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9Ѐ-ӿ]+/g, " ")
    .trim();
}

function noteValue(notes: string | undefined, key: string) {
  const m = notes?.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
  return m ? m[1].trim() : undefined;
}

function firstBodyLine(slides: SlideLike[], from: number, to: number) {
  for (let i = from; i <= to; i++) {
    const line = slides[i]?.content.body
      ?.split("\n")
      .map((l) => l.replace(/^\s*[-•*]\s+/, "").trim())
      .find(Boolean);
    if (line) return line;
  }
  return undefined;
}

/**
 * `notes` is optional and lines up with `slides` by position (presenters get it from
 * get_presenter_notes; the builder reads it from each slide's content).
 */
export function buildSongIndex(slides: SlideLike[], notes?: (string | undefined)[]): SongEntry[] {
  const songs: SongEntry[] = [];
  let prevTitle: string | null = null;
  for (let i = 0; i < slides.length; i++) {
    const title = slides[i].content.title?.trim() ?? "";
    if (!title) {
      // Untitled slide (e.g. an imported picture): belongs to the song before it.
      if (songs.length) songs[songs.length - 1].end = i;
      continue;
    }
    if (title !== prevTitle) {
      songs.push({ index: songs.length, start: i, end: i, title, key: { title: "", firstLine: "", lyrics: "" } });
      prevTitle = title;
    } else {
      songs[songs.length - 1].end = i;
    }
  }
  // A deck where every slide has its own title isn't a song deck; it's just slides.
  if (songs.length > 1 && songs.length === slides.length) return [];

  for (const song of songs) {
    const n = notes?.[song.start];
    song.number = noteValue(n, "Number");
    song.firstLine = noteValue(n, "First line") ?? firstBodyLine(slides, song.start, song.end);
    const lyrics: string[] = [];
    for (let i = song.start; i <= song.end; i++) {
      const c = slides[i].content;
      if (c.body) lyrics.push(c.body);
      if (c.table) lyrics.push(c.table.flat().join(" "));
    }
    song.key = {
      title: normalize(song.title),
      firstLine: normalize(song.firstLine ?? ""),
      lyrics: normalize(lyrics.join(" ")),
    };
  }
  return songs;
}

export type SongMatch = { song: SongEntry; why: "number" | "title" | "first line" | "lyrics" };

/** Best matches first: song number, then title, then first line, then anywhere in the lyrics. */
export function searchSongs(songs: SongEntry[], query: string): SongMatch[] {
  const q = normalize(query);
  if (!q) return songs.map((song) => ({ song, why: "title" as const }));
  const words = q.split(" ");
  const scored: { m: SongMatch; score: number }[] = [];
  for (const song of songs) {
    const { title, firstLine, lyrics } = song.key;
    let score = -1;
    let why: SongMatch["why"] = "title";
    if (/^\d+$/.test(q) && song.number === q) {
      score = 1000;
      why = "number";
    } else if (title === q) score = 900;
    else if (title.startsWith(q)) score = 800;
    else if (` ${title}`.includes(` ${q}`)) score = 700;
    else if (words.every((w) => title.includes(w))) score = 600;
    else if (firstLine.startsWith(q) || ` ${firstLine}`.includes(` ${q}`)) {
      score = 500;
      why = "first line";
    } else if (lyrics.includes(q)) {
      score = 300;
      why = "lyrics";
    } else if (words.length > 1 && words.every((w) => lyrics.includes(w))) {
      score = 100;
      why = "lyrics";
    }
    if (score >= 0) scored.push({ m: { song, why }, score: score - song.index / 10000 });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.m);
}

export function songAt(songs: SongEntry[], slideIndex: number): SongEntry | undefined {
  // songs are in slide order; binary search keeps this instant for large decks
  let lo = 0;
  let hi = songs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = songs[mid];
    if (slideIndex < s.start) hi = mid - 1;
    else if (slideIndex > s.end) lo = mid + 1;
    else return s;
  }
  return undefined;
}
