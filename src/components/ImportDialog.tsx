"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
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
import type { Slide } from "@/lib/types";

type SlideRow = Slide & { position: number };

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
  slides: SlideRow[];
  onClose: () => void;
  /** Called after slides are saved. `removedIds` is the untouched starter slide, if it was replaced. */
  onAdded: (rows: SlideRow[], removedIds: string[], suggestedTitle: string) => void;
};

const KIND_LABEL: Record<ImportKind, string> = {
  pdf: "PDF",
  pptx: "PowerPoint",
  images: "pictures",
};

function unsupportedMessage(files: File[]) {
  const name = files[0]?.name.toLowerCase() ?? "";
  if (name.endsWith(".ppt")) {
    return "That's an older PowerPoint file (.ppt). Open it in PowerPoint and choose File → Save As → .pptx or PDF, then import that.";
  }
  if (name.endsWith(".key")) {
    return "Keynote files can't be read directly. In Keynote choose File → Export To → PDF, then import the PDF.";
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
  const keys = Object.keys(c);
  return slides[0].kind === "built" && keys.length === 1 && c.title === "Welcome";
}

async function uploadAll(
  supabase: SupabaseClient,
  userId: string,
  deckId: string,
  pages: RenderedPage[],
  onProgress: (done: number) => void,
): Promise<string[]> {
  const urls: string[] = new Array(pages.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < pages.length) {
      const i = next++;
      const blob = pages[i].blob;
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" || !blob.type ? "jpg" : "img";
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

export default function ImportDialog({ files, supabase, userId, deckId, slides, onClose, onAdded }: Props) {
  const kind = detectKind(files);
  const [phase, setPhase] = useState<Phase>(
    kind ? { step: "reading", done: 0, total: 0 } : { step: "error", message: unsupportedMessage(files) },
  );
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const pagesRef = useRef<RenderedPage[]>([]);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!kind) return;
    cancelled.current = false;
    const progress = (done: number, total: number) => {
      if (!cancelled.current) setPhase({ step: "reading", done, total });
    };
    (async () => {
      try {
        const result =
          kind === "pdf"
            ? await renderPdf(files[0], progress)
            : kind === "pptx"
              ? await renderPptx(files[0], progress)
              : await renderImages(files, progress);
        if (cancelled.current) {
          releasePreviews(result);
          return;
        }
        if (!result.length) throw new Error("No slides were found in that file.");
        pagesRef.current = result;
        setPages(result);
        setPhase({ step: "preview" });
      } catch (e) {
        if (cancelled.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setPhase({
          step: "error",
          message: /password|encrypt/i.test(msg)
            ? "That file is password-protected. Remove the password and try again."
            : kind === "pptx"
              ? `This PowerPoint file couldn't be read (${msg}). Save it as a PDF from PowerPoint and import that instead.`
              : `That file couldn't be read (${msg}).`,
        });
      }
    })();
    return () => {
      cancelled.current = true;
      releasePreviews(pagesRef.current);
      pagesRef.current = [];
    };
    // Files are fixed for the life of this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setPhase({ step: "saving", done: 0, total: pages.length });
    try {
      const urls = await uploadAll(supabase, userId, deckId, pages, (done) =>
        setPhase({ step: "saving", done, total: pages.length }),
      );
      const replace = isStarterSlide(slides);
      const removedIds = replace ? [slides[0].id] : [];
      if (replace) {
        const { error } = await supabase.from("slides").delete().eq("id", slides[0].id);
        if (error) throw error;
      }
      const base = replace ? 0 : slides.length;
      const rows = urls.map((imageUrl, i) => ({
        deck_id: deckId,
        position: base + i,
        kind: "image" as const,
        content: { imageUrl },
      }));
      const { data, error } = await supabase.from("slides").insert(rows).select("id, kind, content, position");
      if (error || !data) throw error ?? new Error("Could not save the slides");
      const saved = (data as SlideRow[]).sort((a, b) => a.position - b.position);
      const title = kind === "images" ? "" : fileTitle(files[0]);
      onAdded(saved, removedIds, title);
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
              {pages.length} slide{pages.length === 1 ? "" : "s"} from <strong>{files.length === 1 ? files[0].name : `${files.length} pictures`}</strong>.
              {isStarterSlide(slides)
                ? " They'll replace the starter slide."
                : ` They'll be added after slide ${slides.length}.`}
            </p>
            {kind === "pptx" ? (
              <p className="subtle" style={{ margin: 0 }}>
                Check that these look right. If fonts or layout are off, save the deck as a PDF from PowerPoint and import that instead. PDFs always match exactly.
              </p>
            ) : null}
            <div className="import-grid">
              {pages.map((p, i) => (
                <figure key={p.previewUrl} className="import-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt={`Slide ${i + 1}`} />
                  <figcaption>{i + 1}</figcaption>
                </figure>
              ))}
            </div>
            <div className="row">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <span className="spacer" />
              <button className="btn btn-primary" onClick={save}>
                Add {pages.length} slide{pages.length === 1 ? "" : "s"}
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
              {pages.length ? (
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
