"use client";

/**
 * Turns a PDF, a PowerPoint file, or a batch of images into slide pictures,
 * entirely in the browser. Nothing is uploaded until the presenter confirms.
 */

export type RenderedPage = {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};

export type ImportKind = "pdf" | "pptx" | "images";
export type Progress = (done: number, total: number) => void;

/** Longest edge of an imported slide picture, in pixels. Big enough to read on a tablet, small enough for weak signal. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export function detectKind(files: File[]): ImportKind | null {
  if (!files.length) return null;
  const name = files[0].name.toLowerCase();
  if (files.length === 1 && (files[0].type === "application/pdf" || name.endsWith(".pdf"))) return "pdf";
  if (files.length === 1 && (name.endsWith(".pptx") || files[0].type.includes("presentationml"))) return "pptx";
  if (files.every((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name))) {
    return "images";
  }
  return null;
}

export function fileTitle(file: File) {
  return file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not save slide picture"))), "image/jpeg", JPEG_QUALITY),
  );
}

async function finish(canvas: HTMLCanvasElement): Promise<RenderedPage> {
  const blob = await canvasToJpeg(canvas);
  return { blob, previewUrl: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

function fitScale(w: number, h: number) {
  return MAX_EDGE / Math.max(w, h);
}

/** Copies a canvas onto a white background at most MAX_EDGE wide (JPEG has no transparency). */
function flattenToWhite(src: HTMLCanvasElement): HTMLCanvasElement {
  const s = Math.min(1, fitScale(src.width, src.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(src.width * s));
  out.height = Math.max(1, Math.round(src.height * s));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

// ───────────────────────── PDF ─────────────────────────

export async function renderPdf(file: File, onProgress?: Progress): Promise<RenderedPage[]> {
  const pdfjs = await import("pdfjs-dist");
  // Served from /public by scripts/copy-pdf-worker.mjs (runs before dev and build).
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const pages: RenderedPage[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(i - 1, doc.numPages);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: fitScale(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pages.push(await finish(canvas));
      page.cleanup();
    }
    onProgress?.(doc.numPages, doc.numPages);
  } finally {
    await task.destroy();
  }
  return pages;
}

// ───────────────────────── PowerPoint ─────────────────────────

/**
 * Draws each slide with @aiden0z/pptx-renderer (HTML/SVG, tested against real PowerPoint output),
 * then captures it as a picture. Fonts the device lacks are substituted, so the presenter
 * previews the result before anything is saved.
 */
export async function renderPptx(file: File, onProgress?: Progress): Promise<RenderedPage[]> {
  const [{ PptxViewer, RECOMMENDED_ZIP_LIMITS }, { domToCanvas }] = await Promise.all([
    import("@aiden0z/pptx-renderer"),
    import("modern-screenshot"),
  ]);

  const offscreen = (w = 10, h = 10) => {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed",
      left: "-100000px",
      top: "0",
      width: `${w}px`,
      height: `${h}px`,
      overflow: "hidden",
      pointerEvents: "none",
      background: "#ffffff",
    });
    document.body.appendChild(el);
    return el;
  };

  const scratch = offscreen(800, 600);
  const viewer = new PptxViewer(scratch, { zipLimits: RECOMMENDED_ZIP_LIMITS, pdfjs: false });
  const pages: RenderedPage[] = [];
  let host: HTMLDivElement | null = null;
  try {
    await viewer.open(await file.arrayBuffer(), { renderMode: "slide" });
    const n = viewer.slideCount;
    if (!n) throw new Error("No slides found in that PowerPoint file");
    const scale = fitScale(viewer.slideWidth, viewer.slideHeight);
    const width = Math.round(viewer.slideWidth * scale);
    const height = Math.round(viewer.slideHeight * scale);
    host = offscreen(width, height);

    for (let i = 0; i < n; i++) {
      onProgress?.(i, n);
      host.replaceChildren();
      const handle = viewer.renderSlideToContainer(i, host, scale);
      if (!handle) continue;
      try {
        await handle.ready;
        await document.fonts.ready;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const canvas = await domToCanvas(host, {
          width,
          height,
          backgroundColor: "#ffffff",
          scale: 1,
          // The host sits off-screen; the copy being photographed must not.
          style: { position: "static", left: "0", top: "0" },
        });
        pages.push(await finish(flattenToWhite(canvas)));
      } finally {
        handle.dispose();
      }
    }
    onProgress?.(n, n);
  } finally {
    try {
      viewer.destroy();
    } catch {}
    scratch.remove();
    host?.remove();
  }
  return pages;
}

// ───────────────────────── Images ─────────────────────────

export async function renderImages(files: File[], onProgress?: Progress): Promise<RenderedPage[]> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const pages: RenderedPage[] = [];
  for (let i = 0; i < sorted.length; i++) {
    onProgress?.(i, sorted.length);
    const file = sorted[i];
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      bitmap.close();
      pages.push(await finish(flattenToWhite(canvas)));
    } catch {
      // A format this browser can't decode (e.g. HEIC outside Safari): keep the original.
      pages.push({ blob: file, previewUrl: URL.createObjectURL(file), width: 0, height: 0 });
    }
  }
  onProgress?.(sorted.length, sorted.length);
  return pages;
}

export function releasePreviews(pages: RenderedPage[]) {
  for (const p of pages) URL.revokeObjectURL(p.previewUrl);
}
