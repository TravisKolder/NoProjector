"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import SlideView from "@/components/SlideView";
import { getPref, setPref } from "@/lib/device";
import {
  detectKind,
  fileTitle,
  releasePreviews,
  renderImages,
  renderPdf,
  renderPptx,
  type ImportKind,
  type RenderedPage,
} from "@/lib/importSlides";
import { extractPptx, releaseExtracted, type ExtractedSlide } from "@/lib/pptxToBuilt";
import type { Slide, SlideContent } from "@/lib/types";

type SlideRow = Slide & { position: number };
type Mode = "picture" | "theme";

type Phase =
  | { step: "reading"; done: number; total: number }
  | { step: "preview" }
  | { step: "saving"; done: number; total: number }
  | { step: "error"; message: string };

type Props = {
  files: File[];
  supabase: SupabaseClient;
  userId: string;
  deckId: string;
  theme: string;
  slides: SlideRow[];
  onClose: () => void;
  /** Called after slides are saved. `removedIds` is the untouched starter slide, if it was replaced. */
  onAdded: (rows: SlideRow[], removedIds: string[], suggestedTitle: string) => void;
};

/** Large decks: preview the first slides only, so the window stays quick. */
const PREVIEW_MAX = 60;

const KIND_LABEL: Record<ImportKind, string> = { pdf: "PDF", pptx: "PowerPoint", images: "pictures" };

function unsupportedMessage(files: File[]) {
  const name = files[0]?.name.toLowerCase() ?? "";
  if (name.endsWith(".ppt")) {
    return "That's an older PowerPoint file (.ppt). Open it in PowerPoint and choose File → Save As → .pptx or PDF, then import that.";
  }
  if (name.endsWith(".key")) {
    return "Keynote files can't be read directly. In Keynote choose File → Export To → PDF (or PowerPoint), then import that.";
  }
  if (files.length > 1 && files.some((f) => /\.(pdf|pptx)$/i.test(f.name))) {
    return "Import one PDF or PowerPoint file at a time. (You can select many pictures at once.)";
  }
  return "Choose a PDF, a PowerPoint file (.pptx), or pictures of your slides.";
}

/** A brand-new deck starts with a single "Welcome" slide; importing replaces it instead of leaving it at the front. */
function isStarterSlide(slides: SlideRow[]) {
  if (slides.length !== 1) return false;
  const c = slides[0].content;
  return slides[0].kind === "built" && Object.keys(c).length === 1 && c.title === "Welcome";
}

async function uploadAll(
  supabase: SupabaseClient,
  userId: string,
  deckId: string,
  blobs: Blob[],
  onProgress: (done: number) => void,
): Promise<string[]> {
  const urls: string[] = new Array(blobs.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < blobs.length) {
      const i = next++;
      const blob = blobs[i];
      const sub = blob.type.split("/")[1] ?? "jpeg";
      const ext = sub === "jpeg" ? "jpg" : sub === "svg+xml" ? "svg" : sub || "jpg";
      const path = `${userId}/${deckId}/${crypto.randomUUID()}.${ext}`;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.storage
          .from("slide-images")
          .upload(path, blob, { contentType: blob.type || "image/jpeg", cacheControl: "31536000" });
        if (!error) {
          lastError = null;
          break;
        }
        lastError = error;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
      if (lastError) throw lastError;
      urls[i] = supabase.storage.from("slide-images").getPublicUrl(path).data.publicUrl;
      onProgress(++done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return urls;
}

export default function ImportDialog({ files, supabase, userId, deckId, theme, slides, onClose, onAdded }: Props) {
  const kind = detectKind(files);
  const [phase, setPhase] = useState<Phase>(
    kind ? { step: "reading", done: 0, total: 0 } : { step: "error", message: unsupportedMessage(files) },
  );
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [extracted, setExtracted] = useState<ExtractedSlide[] | null>(null);
  const [mode, setMode] = useState<Mode>(() => (getPref("import_mode") === "theme" ? "theme" : "picture"));
  const pagesRef = useRef<RenderedPage[]>([]);
  const extractedRef = useRef<ExtractedSlide[]>([]);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!kind) return;
    cancelled.current = false;
    const progress = (done: number, total: number) => {
      if (!cancelled.current) setPhase({ step: "reading", done, total });
    };
    (async () => {
      let pictures: RenderedPage[] = [];
      let text: ExtractedSlide[] | null = null;
      let pictureError: string | null = null;

      if (kind === "pptx") {
        // Text first (fast), then pictures. Either one alone is still usable.
        try {
          text = await extractPptx(files[0]);
        } catch {
          text = null;
        }
        if (cancelled.current) {
          if (text) releaseExtracted(text);
          return;
        }
        if (text) {
          extractedRef.current = text;
          setExtracted(text);
        }
      }
      try {
        pictures =
          kind === "pdf"
            ? await renderPdf(files[0], progress)
            : kind === "pptx"
              ? await renderPptx(files[0], progress)
              : await renderImages(files, progress);
      } catch (e) {
        pictureError = e instanceof Error ? e.message : String(e);
      }
      if (cancelled.current) {
        releasePreviews(pictures);
        return;
      }
      pagesRef.current = pictures;
      setPages(pictures);

      if (pictures.length || text?.length) {
        if (!pictures.length) setMode("theme");
        else if (!text?.length) setMode("picture");
        setPhase({ step: "preview" });
        return;
      }
      const msg = pictureError ?? "No slides were found in that file.";
      setPhase({
        step: "error",
        message: /password|encrypt/i.test(msg)
          ? "That file is password-protected. Remove the password and try again."
          : kind === "pptx"
            ? `This PowerPoint file couldn't be read (${msg}). Save it as a PDF from PowerPoint and import that instead.`
            : `That file couldn't be read (${msg}).`,
      });
    })();
    return () => {
      cancelled.current = true;
      releasePreviews(pagesRef.current);
      releaseExtracted(extractedRef.current);
      pagesRef.current = [];
      extractedRef.current = [];
    };
    // Files are fixed for the life of this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseMode(m: Mode) {
    setMode(m);
    setPref("import_mode", m);
  }

  // Slides hidden in PowerPoint are left out of both modes. The picture render includes every slide,
  // so it can only be filtered when the two lists line up one-to-one.
  const aligned = kind === "pptx" && !!extracted && extracted.length === pages.length;
  const hiddenIdx = new Set(kind === "pptx" ? (extracted ?? []).flatMap((s, i) => (s.hidden ? [i] : [])) : []);
  const themeSlides = (extracted ?? []).filter((s) => !s.hidden);
  const pictureItems = pages
    .map((page, i) => ({ page, notes: aligned ? extracted![i].content.notes : undefined, i }))
    .filter((x) => !(aligned && hiddenIdx.has(x.i)));
  const useTheme = kind === "pptx" && mode === "theme" && themeSlides.length > 0;
  const count = useTheme ? themeSlides.length : pictureItems.length;
  const skippedCount = useTheme ? themeSlides.filter((s) => s.skipped.length).length : 0;
  const hiddenLeftOut = useTheme || aligned ? hiddenIdx.size : 0;

  async function save() {
    try {
      let rowsContent: { kind: "built" | "image"; content: SlideContent }[];
      if (useTheme) {
        const withImages = themeSlides.map((s, i) => ({ i, blob: s.image?.blob })).filter((x) => x.blob);
        setPhase({ step: "saving", done: 0, total: withImages.length || 1 });
        const urls = await uploadAll(
          supabase,
          userId,
          deckId,
          withImages.map((x) => x.blob!),
          (done) => setPhase({ step: "saving", done, total: withImages.length }),
        );
        const urlFor = new Map(withImages.map((x, k) => [x.i, urls[k]]));
        rowsContent = themeSlides.map((s, i) => ({
          kind: "built" as const,
          content: urlFor.has(i) ? { ...s.content, imageUrl: urlFor.get(i) } : s.content,
        }));
      } else {
        setPhase({ step: "saving", done: 0, total: pictureItems.length });
        const urls = await uploadAll(
          supabase,
          userId,
          deckId,
          pictureItems.map((x) => x.page.blob),
          (done) => setPhase({ step: "saving", done, total: pictureItems.length }),
        );
        // Keep PowerPoint speaker notes with picture slides too.
        rowsContent = urls.map((imageUrl, k) => {
          const notes = pictureItems[k].notes;
          return { kind: "image" as const, content: notes ? { imageUrl, notes } : { imageUrl } };
        });
      }

      const replace = isStarterSlide(slides);
      const removedIds = replace ? [slides[0].id] : [];
      if (replace) {
        const { error } = await supabase.from("slides").delete().eq("id", slides[0].id);
        if (error) throw error;
      }
      const base = replace ? 0 : slides.length;
      const rows = rowsContent.map((r, i) => ({ deck_id: deckId, position: base + i, kind: r.kind, content: r.content }));
      const { data, error } = await supabase.from("slides").insert(rows).select("id, kind, content, position");
      if (error || !data) throw error ?? new Error("Could not save the slides");
      const saved = (data as SlideRow[]).sort((a, b) => a.position - b.position);
      onAdded(saved, removedIds, kind === "images" ? "" : fileTitle(files[0]));
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      setPhase({ step: "error", message: `Saving stopped partway (${msg}). Check your connection and try again.` });
    }
  }

  const busy = phase.step === "reading" || phase.step === "saving";

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Import slides" onClick={busy ? undefined : onClose}>
      <div className="modal stack import-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import slides</h3>

        {phase.step === "reading" ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Reading your {kind ? KIND_LABEL[kind] : "file"}…
              {phase.total ? ` ${Math.min(phase.done + 1, phase.total)} of ${phase.total}` : ""}
            </p>
            <progress max={phase.total || 1} value={phase.done} style={{ width: "100%" }} />
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : null}

        {phase.step === "preview" ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              {count} slide{count === 1 ? "" : "s"} from{" "}
              <strong>{files.length === 1 ? files[0].name : `${files.length} pictures`}</strong>.
              {isStarterSlide(slides) ? " They'll replace the starter slide." : ` They'll be added after slide ${slides.length}.`}
            </p>

            {kind === "pptx" ? (
              <div className="mode-switch" role="group" aria-label="How to import">
                <button
                  type="button"
                  className="mode-option"
                  aria-pressed={mode === "picture"}
                  disabled={!pages.length}
                  onClick={() => chooseMode("picture")}
                >
                  <strong>Keep the original look</strong>
                  <span>Exactly like PowerPoint. Viewers pinch to zoom.</span>
                </button>
                <button
                  type="button"
                  className="mode-option"
                  aria-pressed={mode === "theme"}
                  disabled={!themeSlides.length}
                  onClick={() => chooseMode("theme")}
                >
                  <strong>Use my theme</strong>
                  <span>Editable text. Viewers can enlarge it and switch light/dark.</span>
                </button>
              </div>
            ) : null}

            {kind === "pptx" && !useTheme ? (
              <p className="subtle" style={{ margin: 0 }}>
                If fonts or layout look off, save the deck as a PDF from PowerPoint and import that. PDFs always match exactly.
              </p>
            ) : null}
            {hiddenLeftOut ? (
              <p className="subtle" style={{ margin: 0 }}>
                {hiddenLeftOut} hidden slide{hiddenLeftOut === 1 ? " is" : "s are"} left out, as in PowerPoint.
              </p>
            ) : null}
            {useTheme && skippedCount ? (
              <p className="subtle" style={{ margin: 0 }}>
                {skippedCount} slide{skippedCount === 1 ? " has" : "s have"} diagrams, charts, or extra pictures that
                can&apos;t be turned into text (marked below). Use &ldquo;Keep the original look&rdquo; if you need them.
              </p>
            ) : null}

            <div className="import-grid">
              {useTheme
                ? themeSlides.slice(0, PREVIEW_MAX).map((s, i) => (
                    <figure key={i} className="import-thumb" title={s.skipped.length ? `Left out: ${s.skipped.join(", ")}` : undefined}>
                      <SlideView
                        slide={{
                          id: String(i),
                          kind: "built",
                          content: s.image ? { ...s.content, imageUrl: s.image.previewUrl } : s.content,
                        }}
                        theme={theme}
                        variant="card"
                      />
                      <figcaption>{i + 1}</figcaption>
                      {s.skipped.length ? <span className="skip-note">left out</span> : null}
                    </figure>
                  ))
                : pictureItems.slice(0, PREVIEW_MAX).map(({ page: p }, i) => (
                    <figure key={p.previewUrl} className="import-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.previewUrl} alt={`Slide ${i + 1}`} />
                      <figcaption>{i + 1}</figcaption>
                    </figure>
                  ))}
              {count > PREVIEW_MAX ? (
                <p className="subtle" style={{ gridColumn: "1 / -1", margin: "4px 0" }}>
                  …and {count - PREVIEW_MAX} more slides.
                </p>
              ) : null}
            </div>
            <div className="row">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <span className="spacer" />
              <button className="btn btn-primary" onClick={save} disabled={!count}>
                Add {count} slide{count === 1 ? "" : "s"}
              </button>
            </div>
          </>
        ) : null}

        {phase.step === "saving" ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Saving slides… {phase.done} of {phase.total}
            </p>
            <progress max={phase.total || 1} value={phase.done} style={{ width: "100%" }} />
          </>
        ) : null}

        {phase.step === "error" ? (
          <>
            <p className="error" style={{ margin: 0 }}>
              {phase.message}
            </p>
            <div className="row">
              {count ? (
                <button className="btn btn-primary" onClick={save}>
                  Try saving again
                </button>
              ) : null}
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
