# No Projector

Present slides from a phone, tablet, or computer while everyone in the room follows along on their own phone. Viewers scan a QR code; nothing to install, no account.

Built with Next.js 15, Supabase (Postgres, Auth, Realtime, Storage), and Vercel.

## What works

**Presenters (signed in with a 6-digit code emailed to them)**
- Create decks; slides with a title, text (lines starting with `-` become bullets, indent two spaces per sub-level), an image, a simple table, and private speaker notes
- Four themes, reorder / duplicate / delete slides, autosave
- **Import slides** (`src/components/ImportDialog.tsx`, `src/lib/importSlides.ts`, `src/lib/pptxToBuilt.ts`), all in the browser with a preview before anything is saved:
  - **PDF:** each page becomes a picture slide (PDF.js)
  - **PowerPoint (.pptx):** either *Keep the original look* (each slide rendered to a picture) or *Use my theme* (titles, bullets, text, tables, the main picture, and speaker notes rebuilt as editable slides). Hidden slides are skipped.
  - **Pictures:** one slide per image, in filename order
- Every upload is converted to JPEG, PNG, WebP, or GIF under 10 MB before it leaves the browser (`src/lib/uploadImage.ts`); HEIC, SVG, and BMP are converted, and unreadable files are refused with a plain message
- Start a session → 6-character code, QR code, and a copyable join link; resume a live session from the deck list
- Presenter view: current slide, next-slide preview, notes, live viewer count; arrow keys and clickers work on a laptop
- Lightweight mode: two large Back / Next buttons
- **Song list and search** (`src/lib/songs.ts`, `src/components/SongPicker.tsx`): for decks where each song's slides share a title, a **♪ Songs** button (or **S** on a keyboard) searches by title, song number, first line, or any lyric and jumps every phone to that song. Shows the current song, "used tonight," and when the next slide starts a new song. Also available as **Find song** in the editor.
- Hand off control to anyone in the session, including viewers without an account; the session owner can always take it back
- End the session and either close slides immediately or leave them viewable at the link for 3 hours

**Viewers (no account)**
- Join by QR code, link, or code; optional name (needed only to be handed control)
- Locked to the presenter's slide; text size A−/A+; deck colors / light / dark; screen stays awake
- The deck downloads once at join, so a dropped signal never blanks the screen; after that, reconnects and wake-ups fetch only the small session state and jump to the presenter's slide
- After a kept session ends, free browsing until the 3-hour window closes

## Setup (about 30 minutes)

### 1. Supabase project and database
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste all of `supabase/migrations/0001_init.sql` and run it. It creates the tables, security rules, session functions, and the `slide-images` storage bucket.
3. **New query** again: paste all of `supabase/migrations/0002_hardening.sql` and run it. It limits uploads (10 MB; JPEG, PNG, WebP, GIF), adds the small `get_session_state` call, makes the database announce session changes so codes can't be listed, caps a session at 200 registered devices, and switches session codes to a cryptographic random source. Both files are safe to run more than once.

### 2. Sign-in email
Supabase's built-in sender allows only a few emails an hour and won't let you edit templates, so connect your own sender (these steps use [Resend](https://resend.com)):
1. In Resend, add and verify your domain (it gives you DNS records to add where the domain is managed), then create an API key with **Sending access**.
2. In Supabase, **Authentication → Emails → SMTP settings**: enable custom SMTP. Host `smtp.resend.com`, port `465`, username `resend`, password = the API key, sender = an address on your verified domain.
3. **Authentication → Emails**, edit both **Magic link or OTP** and **Confirm signup** so the email includes the code:
   ```html
   <h2>Sign in to No Projector</h2>
   <p>Your sign-in code is:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>Or tap this link: <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/decks">Sign in to No Projector</a></p>
   ```
4. **Authentication → Rate Limits**: raise the email limit (about 30 an hour).
5. While the app is for your own church, turn off **Authentication → Sign In / Providers → Allow new users to sign up**, and invite presenters from the **Users** page.

### 3. URLs and keys
1. **Authentication → URL Configuration**
   - Site URL: your Vercel URL (e.g. `https://noprojector.vercel.app`)
   - Redirect URLs: `https://YOUR-DOMAIN/auth/callback` and `http://localhost:3000/auth/callback`
2. **Project Settings → API**: copy the Project URL and the public (`anon` / publishable) key. Never use the secret / `service_role` key in this app.

### 4. Run locally
```bash
cp .env.example .env.local   # paste the URL and public key
npm install
npm run dev
```
Open http://localhost:3000. Sign in with the code from the email (the link in the email points at the live site). To test with phones on your Wi-Fi, use your computer's local IP (e.g. `http://192.168.1.20:3000`); the QR code uses whatever address the presenter opened.

### 5. Deploy to Vercel
1. Import the GitHub repo in Vercel.
2. Add the two environment variables from `.env.example` (the Content-Security-Policy reads the Supabase host from `NEXT_PUBLIC_SUPABASE_URL` at build time, so redeploy if it changes).
3. Deploy, then make sure the Site URL and redirect URL in Supabase match the Vercel domain.

## How it fits together

| Piece | Role |
| --- | --- |
| `decks`, `slides` | Presenter-owned content, protected by row-level security |
| `sessions` | One row per session: code, current slide, current presenter, handoff offer, end time. Only the owner can read rows directly; everyone else goes through `get_session` / `get_session_state`. Written only through functions |
| `session_secrets` | Hash of the current presenter token. Never readable by clients |
| `session_viewers` | Random device id, hashed device secret, and display name for each joined phone (up to 200 per session), so only the chosen phone can accept a handoff. Deleted when the session ends |
| Realtime | Each session has a public broadcast channel `np:CODE`. The database sends an empty `refresh` message on every change; phones then call `get_session_state`. Presence gives the viewer list and count |
| `slide-images` bucket | Public pictures for slides; 10 MB, JPEG/PNG/WebP/GIF only; presenters upload into a folder named after their user id |

Key functions: `start_session`, `get_session` (all slides, speaker notes stripped), `get_session_state` (everything but the slides), `get_presenter_notes`, `set_slide`, `register_viewer`, `offer_handoff`, `claim_handoff`, `decline_handoff`, `cancel_handoff`, `reclaim_session`, `end_session`, `verify_presenter`.

A handoff issues a new presenter token to the receiving phone and invalidates the old one, so only one device controls the slides at a time.

Every response carries security headers (Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), set in `next.config.ts`.

## Two-device check after changes
- [ ] Start a session on a laptop, join with 2–3 phones by QR, advance through every slide
- [ ] Turn a phone's Wi-Fi off mid-session, advance two slides, turn it back on; it should jump to the right slide
- [ ] Lock a viewer phone for a minute, unlock; it should resync
- [ ] Hand off to a phone, have them advance, take control back from the laptop
- [ ] Use ♪ Songs to jump between songs far apart in the deck
- [ ] End with "keep 3 hours"; confirm phones can browse; end another with "close now"
- [ ] Import a PDF and a PowerPoint file (both modes)
