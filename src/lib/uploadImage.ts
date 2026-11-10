"use client";

/**
 * One gate for every picture that goes to the `slide-images` bucket.
 *
 * The bucket only accepts these four types, up to 10 MB (see 0002_hardening.sql),
 * so everything is converted here first: oversized photos are shrunk, other formats
 * (HEIC, SVG, BMP, …) are redrawn as JPEG or PNG, and anything the browser can't
 * read is refused with a plain message instead of failing at the server.
 */

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_REJECTED_MESSAGE = "That image couldn't be uploaded. Use a JPEG or PNG under 10 MB.";

/** Longest edge for photos added in the editor. Imports render their own slides at 1600. */
const MAX_EDGE = 1920;
/** Small images in an allowed format are uploaded untouched. */
const KEEP_AS_IS_BYTES = 1_000_000;

export class ImageRejected extends Error {}

export function isAllowedType(type: string) {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

/** createImageBitmap first; an <img> element as a fallback (handles SVG, and HEIC in Safari). */
async function decode(blob: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      // SVGs without a size report 0; give them a sensible canvas.
      const width = img.naturalWidth || 1600;
      const height = img.naturalHeight || 900;
      return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new ImageRejected("That picture's format can't be used here. Use a JPEG or PNG.");
    }
  }
}

function encode(img: Decoded, maxEdge: number, type: "image/jpeg" | "image/png", quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d")!;
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageRejected(UPLOAD_REJECTED_MESSAGE))), type, quality),
  );
}

/**
 * Returns a blob that the bucket will accept, or throws ImageRejected with a message
 * that can be shown to the presenter as is.
 */
export async function prepareImage(blob: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
  const type = blob.type.toLowerCase();

  // GIFs keep their animation, so they're never redrawn; they just have to fit.
  if (type === "image/gif") {
    if (blob.size > MAX_UPLOAD_BYTES) throw new ImageRejected(UPLOAD_REJECTED_MESSAGE);
    return blob;
  }
  if (isAllowedType(type) && blob.size <= KEEP_AS_IS_BYTES) return blob;

  const img = await decode(blob);
  try {
    // Line art (SVG, PNG, BMP) keeps sharp edges and transparency as PNG; photos become JPEG.
    const wantsPng = type === "image/svg+xml" || type === "image/png" || type === "image/bmp";
    let out = await encode(img, maxEdge, wantsPng ? "image/png" : "image/jpeg", 0.85);
    if (out.size > MAX_UPLOAD_BYTES && out.type === "image/png") out = await encode(img, maxEdge, "image/jpeg", 0.85);
    if (out.size > MAX_UPLOAD_BYTES) out = await encode(img, 1600, "image/jpeg", 0.7);
    if (out.size > MAX_UPLOAD_BYTES || !isAllowedType(out.type)) throw new ImageRejected(UPLOAD_REJECTED_MESSAGE);
    return out;
  } finally {
    img.close();
  }
}

/** Final check right before an upload, for blobs produced elsewhere (PDF and PowerPoint renders). */
export function assertUploadable(blob: Blob) {
  if (!isAllowedType(blob.type) || blob.size > MAX_UPLOAD_BYTES) throw new ImageRejected(UPLOAD_REJECTED_MESSAGE);
}

/** True when the storage server refused the file itself (type or size), so retrying won't help. */
export function isUploadRejection(error: unknown) {
  const e = error as { message?: string; statusCode?: string | number; status?: number } | null;
  const msg = `${e?.message ?? ""} ${e?.statusCode ?? ""} ${e?.status ?? ""}`;
  return /mime|content.?type|not supported|exceed|too large|maximum allowed size|payload|\b413\b|\b415\b/i.test(msg);
}

export function uploadErrorMessage(error: unknown) {
  if (error instanceof ImageRejected) return error.message;
  if (isUploadRejection(error)) return UPLOAD_REJECTED_MESSAGE;
  const msg = (error as { message?: string } | null)?.message;
  return msg ? `Upload failed (${msg}). Check your connection and try again.` : "Upload failed. Check your connection and try again.";
}
