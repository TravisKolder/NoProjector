# No Projector

Present slides from a phone, tablet, or computer while everyone in the room follows along on their own phone. Viewers scan a QR code; nothing to install, no account.

Built with Next.js 15, Supabase (Postgres, Auth, Realtime, Storage), and Vercel.

## What works in this first build

**Presenters (signed in by emailed link)**
- Create decks; slides with a title, text (lines starting with `-` become bullets), an image, a simple table, and private speaker notes
- Four themes, reorder / duplicate / delete slides, autosave
- Start a session → 6-character code + QR code; resume a live session from the deck list
- Presenter view: current slide, next-slide preview, notes, live viewer count; arrow keys and clickers work on a laptop
- Lightweight mode: two large Back / Next buttons
- Hand off control to anyone in the session, including viewers without an account; the session owner can always take it back
- End the session and either close slides immediately or leave them viewable at the link for 3 hours

**Viewers (no account)**
- Join by QR or code, optional name (needed only to be handed control)
- Locked to the presenter's slide; text size A−/A+; deck colors / light / dark; screen stays awake
- The whole deck loads at join, so a dropped signal never blanks the screen; reconnecting jumps to the presenter's slide
- After a kept session ends, free browsing until the 3-hour window closes

**Not yet:** PowerPoint / PDF / Google Slides import (planned for week 3).

## Setup (about 15 minutes)

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste all of `supabase/migrations/0001_init.sql`, and run it. It creates the tables, security rules, session functions, the Realtime publication, and the `slide-images` storage bucket. It's safe to run again.
3. **Authentication → URL Configuration**
   - Site URL: your Vercel URL (e.g. `https://noprojector.vercel.app`)
   - Redirect URLs: add `https://YOUR-DOMAIN/auth/callback` and `http://localhost:3000/auth/callback`
4. **Project Settings → API**: copy the Project URL and the `anon` public key.

### 2. Run locally
```bash
cp .env.example .env.local   # paste the URL and anon key
npm install
npm run dev
```
Open http://localhost:3000. To test with phones on your Wi-Fi, use your computer's local IP (e.g. `http://192.168.1.20:3000`); the QR code uses whatever address the presenter opened.

### 3. Deploy to Vercel
1. Push this folder to a GitHub repo and import it in Vercel.
2. Add the two environment variables from `.env.example`.
3. Deploy, then make sure the Site URL and redirect URL in Supabase match the Vercel domain.

## How it fits together

| Piece | Role |
| --- | --- |
| `decks`, `slides` | Presenter-owned content, protected by row-level security |
| `sessions` | One row per live session: code, current slide, current presenter, handoff offer, end time. Readable by anyone while live (or for 3 hours after a kept session ends); written only through functions |
| `session_secrets` | Hash of the current presenter token. Never readable by clients |
| `session_viewers` | Random device id, hashed device secret, and display name for each joined phone, so only the chosen phone can accept a handoff. Deleted when the session ends |
| Realtime | Viewers subscribe to their session row; presence gives the viewer list and count |

Key functions: `start_session`, `get_session` (strips speaker notes), `get_presenter_notes`, `set_slide`, `register_viewer`, `offer_handoff`, `claim_handoff`, `decline_handoff`, `cancel_handoff`, `reclaim_session`, `end_session`.

A handoff issues a new presenter token to the receiving phone and invalidates the old one, so only one device controls the slides at a time.

## Family test checklist
- [ ] Start a session on a laptop, join with 2–3 phones, advance through every slide
- [ ] Turn a phone's Wi-Fi off mid-session, advance two slides, turn it back on; it should jump to the right slide
- [ ] Lock a viewer phone for a minute, unlock; it should resync
- [ ] Hand off to a phone, have them advance, take control back from the laptop
- [ ] End with "keep 3 hours"; confirm phones can browse; end another with "close now"
- [ ] Try lightweight mode on a phone while presenting
