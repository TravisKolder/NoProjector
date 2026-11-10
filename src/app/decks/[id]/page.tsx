"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Brand from "@/components/Brand";
import ImportDialog from "@/components/ImportDialog";
import { DeckBuilderSkeleton } from "@/components/Skeletons";
import SlideView from "@/components/SlideView";
import SongPicker from "@/components/SongPicker";
import { buildSongIndex, songAt } from "@/lib/songs";
import { prepareImage, uploadErrorMessage } from "@/lib/uploadImage";
import { setPresenterToken } from "@/lib/device";
import { THEMES, THEME_IDS } from "@/lib/themes";
import type { Slide, SlideContent, ThemeId } from "@/lib/types";
import { displayNameFor, useUser } from "@/lib/useUser";

type SlideRow = Slide & { position: number };

/** One thumbnail in the slide list. Memoized so typing on one slide doesn't redraw hundreds of others. */
const RailItem = memo(function RailItem({
  slide,
  index,
  active,
  theme,
  onSelect,
}: {
  slide: SlideRow;
  index: number;
  active: boolean;
  theme: string;
  onSelect: (i: number) => void;
}) {
  return (
    <button
      className={`rail-item${active ? " active" : ""}`}
      onClick={() => onSelect(index)}
      aria-label={`Slide ${index + 1}`}
      aria-current={active}
      data-slide={index}
    >
      <span className="num">{index + 1}</span>
      <SlideView slide={slide} theme={theme} variant="thumb" />
    </button>
  );
});
type Deck = { id: string; title: string; theme: ThemeId };
type SaveState = "saved" | "saving" | "unsaved" | "error";

const tableToText = (t?: string[][]) => (t ?? []).map((r) => r.join(" | ")).join("\n");
const textToTable = (s: string) =>
  s
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|").map((c) => c.trim()));

export default function DeckBuilderPage() {
  const { id: deckId } = useParams<{ id: string }>();
  const router = useRouter();
  const { supabase, user } = useUser();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [slides, setSlides] = useState<SlideRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [tableText, setTableText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [importFiles, setImportFiles] = useState<File[] | null>(null);
  const [showSongs, setShowSongs] = useState(false);
  const railRef = useRef<HTMLElement>(null);

  const pending = useRef(new Map<string, SlideContent>());
  const deckPending = useRef<Partial<Deck> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("decks")
        .select("id, title, theme, slides(id, kind, content, position)")
        .eq("id", deckId)
        .single();
      if (error || !data) {
        setError("Deck not found");
        return;
      }
      setDeck({ id: data.id, title: data.title, theme: data.theme as ThemeId });
      const rows = ((data.slides ?? []) as SlideRow[]).sort((a, b) => a.position - b.position);
      setSlides(rows);
      setTableText(tableToText(rows[0]?.content.table));
    })();
  }, [user, supabase, deckId]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const slideSaves = Array.from(pending.current.entries());
    const deckSave = deckPending.current;
    pending.current.clear();
    deckPending.current = null;
    if (!slideSaves.length && !deckSave) return true;
    setSaveState("saving");
    const results = await Promise.all([
      ...slideSaves.map(([id, content]) => supabase.from("slides").update({ content }).eq("id", id)),
      supabase
        .from("decks")
        .update({ ...(deckSave ?? {}), updated_at: new Date().toISOString() })
        .eq("id", deckId),
    ]);
    const failed = results.find((r) => r.error);
    setSaveState(failed ? "error" : "saved");
    if (failed) setError(failed.error!.message);
    return !failed;
  }, [supabase, deckId]);

  const scheduleSave = useCallback(() => {
    setSaveState("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  }, [flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current.size || deckPending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const current = slides[selected];
  const songs = useMemo(() => buildSongIndex(slides, slides.map((s) => s.content.notes)), [slides]);

  // Keep the selected thumbnail in view (e.g. after jumping to a song far down the deck).
  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>(`[data-slide="${selected}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  function updateContent(patch: Partial<SlideContent>) {
    if (!current) return;
    const content = { ...current.content, ...patch };
    for (const k of Object.keys(content) as (keyof SlideContent)[]) {
      if (content[k] === "" || content[k] === undefined) delete content[k];
    }
    setSlides((s) => s.map((x, i) => (i === selected ? { ...x, content } : x)));
    pending.current.set(current.id, content);
    scheduleSave();
  }

  function updateDeck(patch: Partial<Deck>) {
    setDeck((d) => (d ? { ...d, ...patch } : d));
    deckPending.current = { ...(deckPending.current ?? {}), ...patch };
    scheduleSave();
  }

  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const selectIndex = useCallback((i: number) => {
    setSelected(i);
    setTableText(tableToText(slidesRef.current[i]?.content.table));
  }, []);

  function select(i: number, rows: SlideRow[] = slides) {
    setSelected(i);
    setTableText(tableToText(rows[i]?.content.table));
  }

  async function addSlide() {
    await flush();
    const position = slides.length;
    const { data, error } = await supabase
      .from("slides")
      .insert({ deck_id: deckId, position, content: {} })
      .select("id, kind, content, position")
      .single();
    if (error || !data) return setError(error?.message ?? "Could not add slide");
    setSlides((s) => [...s, data as SlideRow]);
    setSelected(position);
    setTableText("");
  }

  async function persistOrder(rows: SlideRow[]) {
    setSaveState("saving");
    const results = await Promise.all(
      rows.map((r, i) => supabase.from("slides").update({ position: i }).eq("id", r.id)),
    );
    setSaveState(results.some((r) => r.error) ? "error" : "saved");
  }

  async function move(delta: -1 | 1) {
    const to = selected + delta;
    if (to < 0 || to >= slides.length) return;
    await flush();
    const rows = [...slides];
    [rows[selected], rows[to]] = [rows[to], rows[selected]];
    const renumbered = rows.map((r, i) => ({ ...r, position: i }));
    setSlides(renumbered);
    setSelected(to);
    await persistOrder(renumbered);
  }

  async function duplicate() {
    if (!current) return;
    await flush();
    const rows = [...slides];
    const { data, error } = await supabase
      .from("slides")
      .insert({ deck_id: deckId, position: selected + 1, kind: current.kind, content: current.content })
      .select("id, kind, content, position")
      .single();
    if (error || !data) return setError(error?.message ?? "Could not duplicate");
    rows.splice(selected + 1, 0, data as SlideRow);
    const renumbered = rows.map((r, i) => ({ ...r, position: i }));
    setSlides(renumbered);
    select(selected + 1);
    await persistOrder(renumbered);
  }

  async function removeSlide() {
    if (!current || !confirm("Delete this slide?")) return;
    pending.current.delete(current.id);
    const { error } = await supabase.from("slides").delete().eq("id", current.id);
    if (error) return setError(error.message);
    const rows = slides.filter((_, i) => i !== selected).map((r, i) => ({ ...r, position: i }));
    setSlides(rows);
    const next = Math.max(0, Math.min(selected, rows.length - 1));
    setSelected(next);
    setTableText(tableToText(rows[next]?.content.table));
    await persistOrder(rows);
  }

  async function uploadImage(file: File) {
    if (!user || !current) return;
    // Very large files are refused before decoding so a phone doesn't run out of memory.
    if (file.size > 50 * 1024 * 1024) return setError("That image is too large. Use a JPEG or PNG under 10 MB.");
    setUploading(true);
    setError(null);
    let blob: Blob;
    try {
      // Shrinks big photos and converts other formats (HEIC, SVG, BMP) to JPEG or PNG.
      blob = await prepareImage(file);
    } catch (e) {
      setUploading(false);
      return setError(uploadErrorMessage(e));
    }
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[blob.type] ?? "jpg";
    const path = `${user.id}/${deckId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("slide-images")
      .upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
    setUploading(false);
    if (error) return setError(uploadErrorMessage(error));
    const { data } = supabase.storage.from("slide-images").getPublicUrl(path);
    updateContent({ imageUrl: data.publicUrl });
  }

  async function openImport(files: File[]) {
    if (!files.length) return;
    await flush();
    setError(null);
    setImportFiles(files);
  }

  function finishImport(rows: SlideRow[], removedIds: string[], suggestedTitle: string) {
    setImportFiles(null);
    const kept = slides.filter((s) => !removedIds.includes(s.id));
    const all = [...kept, ...rows].sort((a, b) => a.position - b.position);
    setSlides(all);
    const first = all.findIndex((s) => s.id === rows[0]?.id);
    select(Math.max(0, first), all);
    if (deck && suggestedTitle && /^untitled deck$/i.test(deck.title.trim())) updateDeck({ title: suggestedTitle });
  }

  async function startSession() {
    if (!deck) return;
    setStarting(true);
    setError(null);
    const ok = await flush();
    if (!ok) {
      setStarting(false);
      return;
    }
    const { data, error } = await supabase.rpc("start_session", {
      p_deck_id: deck.id,
      p_presenter_name: displayNameFor(user),
    });
    if (error || !data) {
      setStarting(false);
      return setError(error?.message ?? "Could not start the session");
    }
    const { code, token } = data as { code: string; token: string };
    setPresenterToken(code, token);
    router.push(`/present/${code}`);
  }

  async function deleteDeck() {
    if (!deck || !confirm(`Delete "${deck.title}" and all its slides? This can't be undone.`)) return;
    const { error } = await supabase.from("decks").delete().eq("id", deck.id);
    if (error) return setError(error.message);
    router.replace("/decks");
  }

  if (error && !deck) {
    return (
      <main className="page narrow">
        <p className="error">{error}</p>
        <Link href="/decks">Back to decks</Link>
      </main>
    );
  }
  if (!deck) return <DeckBuilderSkeleton />;

  const saveLabel = { saved: "All changes saved", saving: "Saving…", unsaved: "Editing…", error: "Couldn't save" }[saveState];

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <div className="topbar">
        <div className="row">
          <Brand />
          <Link href="/decks" className="subtle">
            ← Decks
          </Link>
        </div>
        <div className="row">
          <span className="save-state">{saveLabel}</span>
          <button className="btn btn-primary" onClick={startSession} disabled={starting || slides.length === 0}>
            {starting ? "Starting…" : "Start session"}
          </button>
        </div>
      </div>

      <div className="card stack" style={{ marginBottom: 20 }}>
        <div>
          <label className="label" htmlFor="deck-title">
            Deck title
          </label>
          <input
            id="deck-title"
            className="input"
            value={deck.title}
            onChange={(e) => updateDeck({ title: e.target.value })}
          />
        </div>
        <div>
          <span className="label">Theme</span>
          <div className="theme-swatches">
            {THEME_IDS.map((id) => {
              const t = THEMES[id];
              return (
                <button
                  key={id}
                  type="button"
                  className={`swatch${deck.theme === id ? " active" : ""}`}
                  style={{ background: t.bg, color: t.accent, fontFamily: t.font }}
                  onClick={() => updateDeck({ theme: id })}
                  aria-pressed={deck.theme === id}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="builder">
        <nav className="slide-rail" aria-label="Slides" ref={railRef}>
          {songs.length ? (
            <button className="btn btn-sm btn-primary btn-songs" onClick={() => setShowSongs(true)}>
              ♪ Find song ({songs.length})
            </button>
          ) : null}
          {slides.map((s, i) => (
            <RailItem key={s.id} slide={s} index={i} active={i === selected} theme={deck.theme} onSelect={selectIndex} />
          ))}
          <button className="btn btn-sm" onClick={addSlide}>
            + Add slide
          </button>
          <label className="btn btn-sm" title="PDF, PowerPoint (.pptx), or pictures">
            Import slides…
            <input
              type="file"
              hidden
              multiple
              accept=".pdf,application/pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                openImport(files);
              }}
            />
          </label>
        </nav>

        {current ? (
          <section className="editor-grid">
            <SlideView slide={current} theme={deck.theme} variant="preview" />
            <div className="row">
              <button className="btn btn-sm" onClick={() => move(-1)} disabled={selected === 0}>
                ↑ Move up
              </button>
              <button className="btn btn-sm" onClick={() => move(1)} disabled={selected === slides.length - 1}>
                ↓ Move down
              </button>
              <button className="btn btn-sm" onClick={duplicate}>
                Duplicate
              </button>
              <span className="spacer" />
              <button className="btn btn-sm btn-danger" onClick={removeSlide}>
                Delete slide
              </button>
            </div>

            {current.kind === "image" ? (
              <div className="card stack">
                <p className="muted" style={{ margin: 0 }}>
                  Imported slide. Viewers see it exactly as shown and can pinch to zoom. To change the words, edit
                  the original file and import it again.
                </p>
                <div className="row">
                  <label className="btn btn-sm">
                    {uploading ? "Uploading…" : "Replace picture"}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) uploadImage(f);
                      }}
                    />
                  </label>
                </div>
                <div>
                  <label className="label" htmlFor="s-notes-img">
                    Speaker notes <span className="subtle">(only you see these)</span>
                  </label>
                  <textarea
                    id="s-notes-img"
                    className="textarea"
                    rows={3}
                    value={current.content.notes ?? ""}
                    onChange={(e) => updateContent({ notes: e.target.value })}
                  />
                </div>
              </div>
            ) : (
            <div className="card stack">
              <div>
                <label className="label" htmlFor="s-title">
                  Title
                </label>
                <input
                  id="s-title"
                  className="input"
                  value={current.content.title ?? ""}
                  onChange={(e) => updateContent({ title: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="s-body">
                  Text
                </label>
                <textarea
                  id="s-body"
                  className="textarea"
                  rows={6}
                  placeholder={"Write a paragraph, or start lines with - for bullets."}
                  value={current.content.body ?? ""}
                  onChange={(e) => updateContent({ body: e.target.value })}
                />
              </div>
              <div>
                <span className="label">Image</span>
                <div className="row">
                  <label className="btn btn-sm">
                    {uploading ? "Uploading…" : current.content.imageUrl ? "Replace image" : "Add image"}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) uploadImage(f);
                      }}
                    />
                  </label>
                  {current.content.imageUrl ? (
                    <button className="btn btn-sm btn-ghost" onClick={() => updateContent({ imageUrl: undefined })}>
                      Remove image
                    </button>
                  ) : null}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="s-table">
                  Table <span className="subtle">(one row per line, separate cells with |, first row is the header)</span>
                </label>
                <textarea
                  id="s-table"
                  className="textarea"
                  rows={4}
                  placeholder={"Book | Chapters\nRomans | 16\nJames | 5"}
                  value={tableText}
                  onChange={(e) => {
                    setTableText(e.target.value);
                    const table = textToTable(e.target.value);
                    updateContent({ table: table.length ? table : undefined });
                  }}
                />
              </div>
              <div>
                <label className="label" htmlFor="s-notes">
                  Speaker notes <span className="subtle">(only you see these)</span>
                </label>
                <textarea
                  id="s-notes"
                  className="textarea"
                  rows={3}
                  value={current.content.notes ?? ""}
                  onChange={(e) => updateContent({ notes: e.target.value })}
                />
              </div>
            </div>
            )}
          </section>
        ) : (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              This deck has no slides yet. Add one, or import a PDF, PowerPoint file, or pictures.
            </p>
          </div>
        )}
      </div>

      {showSongs ? (
        <SongPicker
          songs={songs}
          current={songAt(songs, selected)}
          onPick={(song) => {
            setShowSongs(false);
            select(song.start);
          }}
          onClose={() => setShowSongs(false)}
        />
      ) : null}

      {importFiles && user ? (
        <ImportDialog
          files={importFiles}
          supabase={supabase}
          userId={user.id}
          deckId={deckId}
          theme={deck.theme}
          slides={slides}
          onClose={() => setImportFiles(null)}
          onAdded={finishImport}
        />
      ) : null}

      <div style={{ marginTop: 40 }}>
        <button className="btn btn-sm btn-ghost btn-danger" onClick={deleteDeck}>
          Delete deck
        </button>
      </div>
    </main>
  );
}
