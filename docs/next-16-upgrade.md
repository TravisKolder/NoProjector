# Note for Travis: the PostCSS advisory and Next.js 16

*Written 2026-11-09. Report only; nothing was upgraded.*

## What `npm audit` reports

Two advisories (1 moderate, 1 high) in **PostCSS 8.4.31**, the copy bundled inside **Next.js 15.5.28**: an XSS issue in PostCSS's CSS output, and a few ways a malicious CSS comment could make PostCSS read local `.map` files. The only automatic fix is `npm audit fix --force`, which installs **Next.js 16.4.6**, a major upgrade.

**Risk here is low.** PostCSS only runs at build time, on CSS this project writes itself (`src/app/globals.css`). No user-supplied CSS ever goes through it, and nothing it produces is served from user input. It's worth fixing eventually, not urgently.

## What the Next.js 16 upgrade would change in this codebase

Checked against the official guide ([Upgrading to version 16](https://nextjs.org/docs/app/guides/upgrading/version-16)).

| Area | Change in Next 16 | Effect on No Projector |
| --- | --- | --- |
| **Middleware** | `middleware.ts` is renamed to `proxy.ts`, and the exported function to `proxy`. Proxy always runs on the Node.js runtime. | **One real change.** `src/middleware.ts` (the Supabase cookie refresh) becomes `src/proxy.ts` with `export async function proxy(...)`. The `config.matcher` stays. The upgrade codemod does this automatically. Node runtime is fine for `@supabase/ssr`. |
| **Async request APIs** | Synchronous `cookies()`, `headers()`, `params`, `searchParams` are removed. | **No change needed.** `src/lib/supabase/server.ts` already uses `await cookies()`. The two route handlers (`auth/callback`, `auth/confirm`) read `request.url` only. Pages get params through the `useParams()` client hook. |
| **Bundler** | `next build` uses Turbopack by default (`--webpack` opts out). | **Needs testing.** There's no custom webpack config, so it builds with Turbopack. The import features load PDF.js, `@aiden0z/pptx-renderer`, `modern-screenshot`, and JSZip on demand. Re-test PDF and PowerPoint import (both modes) and watch for Content-Security-Policy errors. If anything breaks, `"build": "next build --webpack"` keeps the old bundler. |
| **Versions** | Node.js 20.9+, TypeScript 5.1+, React 19.2. | Update `react`, `react-dom`, `@types/react`, `@types/react-dom` together with `next`. Vercel's default Node version already meets 20.9. |
| **Config** (`next.config.ts`) | `headers()` is unchanged; `images` defaults changed (cache TTL, qualities, local IPs). | **No change needed.** The security headers carry over as-is. The app uses plain `<img>` with `images.unoptimized`, so the image changes don't apply. |
| **Removed features** | AMP, `next lint`, runtime config, PPR flags. | None are used. |
| **Build output** | `next build` no longer prints per-page sizes; `next dev` writes to `.next/dev`. | Cosmetic. `.next` is already in `.gitignore`. |

## Suggested way to do it, when you're ready

1. On a new branch: `npx @next/codemod@canary upgrade latest` (renames middleware → proxy, bumps packages).
2. `npm run typecheck && npm run build`.
3. On the Vercel preview link: sign in, edit a deck, upload a photo, import a PDF and a PowerPoint file (both modes), start a session, and run the two-device check in the README.
4. Merge only if all of that passes. If the Turbopack build misbehaves, use `next build --webpack`.

Estimated effort: under an hour of changes, plus the test pass. Choose a quiet week, not the week before a gathering.
