"use client";

/**
 * Reads the words out of a PowerPoint file and rebuilds each slide as a regular
 * No Projector slide (title, bullets, text, table, main picture, speaker notes),
 * so it follows the deck theme and viewers' text size and light/dark settings.
 * The original design (backgrounds, layout, shapes, fonts) is intentionally dropped.
 */

import type { SlideContent } from "@/lib/types";

export type ExtractedImage = { blob: Blob; previewUrl: string };

export type ExtractedSlide = {
  content: SlideContent;
  image?: ExtractedImage;
  /** Things on the slide that couldn't come across as text (diagrams, charts, extra pictures). */
  skipped: string[];
  /** Hidden in PowerPoint ("Hide Slide"). Kept in the list so positions line up with the picture render. */
  hidden: boolean;
};

type Zip = {
  file(path: string): { async(type: "string"): Promise<string>; async(type: "blob"): Promise<Blob> } | null;
};

const NS = {
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
};

const SHOWABLE_IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

// ───────── small XML helpers (namespace-aware, so prefixes in the file don't matter) ─────────

function parseXml(text: string) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function kids(el: Element, ns: string, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === name);
}

function kid(el: Element | null | undefined, ns: string, name: string): Element | null {
  return el ? (kids(el, ns, name)[0] ?? null) : null;
}

function all(el: Element | Document, ns: string, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(ns, name));
}

function resolvePath(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

async function readRels(zip: Zip, partPath: string): Promise<Map<string, { type: string; target: string }>> {
  const dir = partPath.split("/").slice(0, -1).join("/");
  const name = partPath.split("/").pop();
  const xml = await zip.file(`${dir}/_rels/${name}.rels`)?.async("string");
  const map = new Map<string, { type: string; target: string }>();
  if (!xml) return map;
  for (const r of all(parseXml(xml), NS.rel, "Relationship")) {
    const id = r.getAttribute("Id");
    const target = r.getAttribute("Target");
    if (!id || !target || r.getAttribute("TargetMode") === "External") continue;
    map.set(id, { type: r.getAttribute("Type") ?? "", target: resolvePath(partPath, target) });
  }
  return map;
}

// ───────── text ─────────

type Para = { text: string; level: number; bullet: boolean };

function paragraphText(p: Element): string {
  let out = "";
  for (const c of Array.from(p.children)) {
    if (c.namespaceURI !== NS.a) continue;
    if (c.localName === "r" || c.localName === "fld") out += kid(c, NS.a, "t")?.textContent ?? "";
    else if (c.localName === "br") out += "\n";
  }
  return out.replace(/\u000b/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** `defaultBullet`: body placeholders are bulleted unless told otherwise; free text boxes are not. */
function paragraphs(txBody: Element | null, defaultBullet: boolean): Para[] {
  if (!txBody) return [];
  return kids(txBody, NS.a, "p")
    .map((p) => {
      const pPr = kid(p, NS.a, "pPr");
      const level = Math.min(4, Number(pPr?.getAttribute("lvl") ?? 0) || 0);
      let bullet = defaultBullet;
      if (pPr && kid(pPr, NS.a, "buNone")) bullet = false;
      if (pPr && (kid(pPr, NS.a, "buChar") || kid(pPr, NS.a, "buAutoNum") || kid(pPr, NS.a, "buBlip"))) bullet = true;
      return { text: paragraphText(p), level, bullet };
    })
    .filter((p) => p.text !== "");
}

/** Bullets become "- text" lines (indented two spaces per level); plain paragraphs are separated by blank lines. */
function toBody(paras: Para[]): string {
  const lines: string[] = [];
  let prevBullet: boolean | null = null;
  for (const p of paras) {
    if (prevBullet !== null && prevBullet !== p.bullet) lines.push("");
    if (p.bullet) lines.push(`${"  ".repeat(p.level)}- ${p.text.replace(/\n/g, " ")}`);
    else {
      if (prevBullet === false) lines.push("");
      lines.push(p.text);
    }
    prevBullet = p.bullet;
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ───────── shapes on a slide ─────────

type Box = { x: number; y: number; w: number; h: number };

function boxOf(el: Element): Box {
  const xfrm = all(el, NS.a, "xfrm")[0];
  const off = kid(xfrm, NS.a, "off");
  const ext = kid(xfrm, NS.a, "ext");
  return {
    x: Number(off?.getAttribute("x") ?? 0),
    y: Number(off?.getAttribute("y") ?? 0),
    w: Number(ext?.getAttribute("cx") ?? 0),
    h: Number(ext?.getAttribute("cy") ?? 0),
  };
}

type Item =
  | { kind: "title"; box: Box; text: string }
  | { kind: "text"; box: Box; paras: Para[] }
  | { kind: "table"; box: Box; rows: string[][] }
  | { kind: "picture"; box: Box; relId: string }
  | { kind: "other"; box: Box; label: string };

function placeholderType(sp: Element): string | null {
  const nv = kid(sp, NS.p, "nvSpPr") ?? kid(sp, NS.p, "nvPicPr") ?? kid(sp, NS.p, "nvGraphicFramePr");
  const ph = kid(kid(nv, NS.p, "nvPr"), NS.p, "ph");
  if (!ph) return null;
  return ph.getAttribute("type") ?? "body"; // a placeholder with only an idx is a content/body placeholder
}

function collect(container: Element, out: Item[]) {
  for (const el of Array.from(container.children)) {
    if (el.namespaceURI !== NS.p) continue;
    if (el.localName === "grpSp") {
      collect(el, out);
      continue;
    }
    const box = boxOf(el);
    if (el.localName === "sp") {
      const type = placeholderType(el);
      if (type && ["dt", "ftr", "sldNum", "hdr"].includes(type)) continue;
      const txBody = kid(el, NS.p, "txBody");
      if (type === "title" || type === "ctrTitle") {
        const text = paragraphs(txBody, false)
          .map((p) => p.text.replace(/\n/g, " "))
          .join(" ");
        if (text) out.push({ kind: "title", box, text });
      } else {
        const bulleted = type !== null && type !== "subTitle";
        const paras = paragraphs(txBody, bulleted);
        if (paras.length) out.push({ kind: "text", box, paras });
      }
    } else if (el.localName === "pic") {
      const blip = all(el, NS.a, "blip")[0];
      const relId = blip?.getAttributeNS(NS.r, "embed") ?? blip?.getAttribute("r:embed");
      if (relId) out.push({ kind: "picture", box, relId });
    } else if (el.localName === "graphicFrame") {
      const tbl = all(el, NS.a, "tbl")[0];
      if (tbl) {
        const rows = all(tbl, NS.a, "tr").map((tr) =>
          kids(tr, NS.a, "tc").map((tc) =>
            all(tc, NS.a, "p")
              .map(paragraphText)
              .filter(Boolean)
              .join(" "),
          ),
        );
        if (rows.some((r) => r.some((c) => c))) out.push({ kind: "table", box, rows });
      } else {
        const uri = all(el, NS.a, "graphicData")[0]?.getAttribute("uri") ?? "";
        out.push({ kind: "other", box, label: /chart/i.test(uri) ? "a chart" : /diagram/i.test(uri) ? "a diagram" : "an object" });
      }
    }
  }
}

// ───────── public ─────────

export async function extractPptx(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedSlide[]> {
  const JSZip = (await import("jszip")).default;
  const zip = (await JSZip.loadAsync(await file.arrayBuffer())) as unknown as Zip;

  const presPath = "ppt/presentation.xml";
  const presXml = await zip.file(presPath)?.async("string");
  if (!presXml) throw new Error("This doesn't look like a PowerPoint file");
  const pres = parseXml(presXml);
  const presRels = await readRels(zip, presPath);
  const sldSz = all(pres, NS.p, "sldSz")[0];
  const slideArea = Number(sldSz?.getAttribute("cx") ?? 12192000) * Number(sldSz?.getAttribute("cy") ?? 6858000);

  const slidePaths = all(pres, NS.p, "sldId")
    .map((s) => presRels.get(s.getAttributeNS(NS.r, "id") ?? s.getAttribute("r:id") ?? "")?.target)
    .filter((p): p is string => !!p);

  const result: ExtractedSlide[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    onProgress?.(i, slidePaths.length);
    const path = slidePaths[i];
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const doc = parseXml(xml);
    const hidden = doc.documentElement.getAttribute("show") === "0";
    const tree = all(doc, NS.p, "spTree")[0];
    const rels = await readRels(zip, path);
    const items: Item[] = [];
    if (tree) collect(tree, items);
    items.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

    const content: SlideContent = {};
    const skipped: string[] = [];

    const titles = items.filter((it): it is Extract<Item, { kind: "title" }> => it.kind === "title");
    if (titles.length) content.title = titles.map((t) => t.text).join(" — ");

    const texts = items.filter((it): it is Extract<Item, { kind: "text" }> => it.kind === "text");
    const body = texts.map((t) => toBody(t.paras)).filter(Boolean).join("\n\n");
    if (body) {
      // A slide with no title but some text: use a short first line as the title.
      if (!content.title) {
        const [first, ...rest] = body.split("\n");
        if (first && !first.trimStart().startsWith("- ") && first.length <= 80 && rest.join("").trim()) {
          content.title = first.trim();
          content.body = rest.join("\n").trim();
        } else content.body = body;
      } else content.body = body;
    }

    const tables = items.filter((it): it is Extract<Item, { kind: "table" }> => it.kind === "table");
    if (tables.length) {
      content.table = tables[0].rows;
      if (tables.length > 1) skipped.push(`${tables.length - 1} more table${tables.length > 2 ? "s" : ""}`);
    }

    // Keep the largest picture that's big enough to matter (skips logos and icons).
    const pics = items
      .filter((it): it is Extract<Item, { kind: "picture" }> => it.kind === "picture")
      .map((p) => ({ ...p, target: rels.get(p.relId)?.target, area: p.box.w * p.box.h }))
      .filter((p) => p.target && p.area >= slideArea * 0.04)
      .sort((a, b) => b.area - a.area);
    let image: ExtractedImage | undefined;
    const main = pics.find((p) => SHOWABLE_IMAGE.test(p.target!));
    if (main) {
      const raw = await zip.file(main.target!)?.async("blob");
      if (raw) {
        const ext = main.target!.split(".").pop()!.toLowerCase();
        const blob = new Blob([raw], { type: MIME[ext] ?? "image/png" });
        image = { blob, previewUrl: URL.createObjectURL(blob) };
      }
    }
    if (pics.length > (image ? 1 : 0)) {
      const n = pics.length - (image ? 1 : 0);
      skipped.push(`${n} picture${n > 1 ? "s" : ""}`);
    }
    for (const o of items) if (o.kind === "other") skipped.push(o.label);

    // Speaker notes
    const notesRel = Array.from(rels.values()).find((r) => r.type.endsWith("/notesSlide"));
    if (notesRel) {
      const nxml = await zip.file(notesRel.target)?.async("string");
      if (nxml) {
        const ndoc = parseXml(nxml);
        const notes = all(ndoc, NS.p, "sp")
          .filter((sp) => placeholderType(sp) === "body")
          .flatMap((sp) => paragraphs(kid(sp, NS.p, "txBody"), false).map((p) => p.text))
          .join("\n")
          .trim();
        if (notes) content.notes = notes;
      }
    }

    result.push({ content, image, skipped, hidden });
  }
  onProgress?.(slidePaths.length, slidePaths.length);
  if (!result.length) throw new Error("No slides found in that PowerPoint file");
  return result;
}

export function releaseExtracted(slides: ExtractedSlide[]) {
  for (const s of slides) if (s.image) URL.revokeObjectURL(s.image.previewUrl);
}
