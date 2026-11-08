// Copies PDF.js's worker into /public so the browser can load it for PDF import.
// Runs automatically before `npm run dev` and `npm run build` (including on Vercel).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
mkdirSync("public", { recursive: true });
copyFileSync(src, path.join("public", "pdf.worker.min.mjs"));
console.log("Copied pdf.worker.min.mjs to public/");
