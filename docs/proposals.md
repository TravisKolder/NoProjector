# Proposals waiting on Travis (Tasks 13 and 14)

Nothing in this file has been built. Each needs a yes, a no, or changes first.

---

## Task 13: A warmer accent color

**The proposal:** replace the default blue with the brown from the Parchment slide theme, and warm the grey page background slightly. The body text stays in the system font, and no font is downloaded.

| | Now | Proposed |
| --- | --- | --- |
| Light: accent (buttons, links, logo) | `#2f5bea` blue | `#9a4b1d` brown |
| Light: page background | `#f5f6f8` cool grey | `#f6f3ee` warm off-white |
| Light: soft accent (highlighted rows) | `#e8eefe` | `#f7ebe1` |
| Light: borders | `#e2e4ea` | `#e6dfd3` |
| Dark: accent | `#7ea2ff` light blue | `#e8a46a` amber |
| Dark: text on accent buttons | `#0b1020` | `#1f1308` |
| Dark: soft accent | `#1d2640` | `#33231a` |

**Contrast** (4.5:1 is the target for body text; higher is easier to read):

| Pair | Ratio |
| --- | --- |
| Light: white text on a brown button | 6.2 |
| Light: brown link on the page background | 5.6 |
| Light: brown on a soft highlighted row | 5.3 |
| Light: body text on the new background | 16.1 (secondary text: 7.2) |
| Dark: dark text on an amber button | 8.6 |
| Dark: amber on the page background | 9.0 |
| Dark: amber on a card | 8.3 |

Every pair passes and most improve on today's blue (5.5 for a light-mode button).

**Why this option rather than a headline font:** it changes how the whole app feels with seven color values in one file, it costs nothing to load, and it ties the app to the look of the slides people already see. A font could be added later on top of it.

**What doesn't change:** slide themes, the viewer screen, the green "in sync" dot, and the red warnings.

**If approved:** one commit that edits the color values at the top of `globals.css`, followed by screenshots of every page in light and dark mode.

---

## Task 14: "Tonight's set"

### The problem
Travis has one deck of about 880 slides and 71 songs, and picks about 10 songs per gathering, often changing them on the spot. Today he starts the session and jumps with ♪ Songs each time. That works, but there is no way to plan ahead, and the deck list shows one thumbnail that says nothing about the songs.

### The flow

**1. Plan the set (before the gathering, from any device)**
- On the deck list, a deck that has songs gets a **Plan a set** button next to Edit and Present.
- The set page has the same song search as ♪ Songs (title, number, first line, any lyric) on one side and **Tonight's set** on the other.
- Tap a song to add it. Drag (or use ↑/↓ buttons on a phone) to reorder, and tap × to remove.
- The set saves automatically, and the most recent set is what **Present** uses.

**2. Present from the set**
- Starting a session from a set opens on the first song in the set.
- The presenter screen gets a **Set** strip: the songs in order, with the current one highlighted and the played ones dimmed. Tap any song in the strip to jump to it.
- On the last slide of a song, **Next** reads "Next: *How Great Is Our God* (set 4 of 10)" and goes to the start of the next song in the set, not the next song in the deck. Arrow keys and clickers do the same.

**3. Change course mid-gathering**
- ♪ Songs still searches the whole deck. Picking a song not in the set jumps to it, as today, and adds it to the set right after the current song so "Next" carries on sensibly. (An **Add to set** checkbox in the picker, on by default, lets him jump without changing the set.)
- He can also skip ahead in the strip, or play a song twice.

**4. Viewers**
- No change: viewers still download the whole deck once and follow the presenter. The set only affects what the presenter's buttons do.

### How it would be built
- **Storage:** a new `set_lists` table (deck, name, date, list of songs), owned by the presenter and protected by row-level security like decks. This would go in a new migration (`0003_set_lists.sql`). It means a set planned on a laptop at home is there on the phone at church, and past sets are kept.
- **Song matching:** each song in a set is saved by its title and number, not its slide position, so editing or reordering the deck doesn't break saved sets. A song that has since been deleted is shown greyed out with "not in deck anymore".
- **Reuse:** `src/lib/songs.ts` (`buildSongIndex`, `searchSongs`, `songAt`) already does the song splitting and searching. `SongPicker.tsx` already handles search, "used tonight" and keyboard use, so the set page and strip build on those.
- **Size:** roughly one new page, one new table, and changes to the presenter screen and the Next button. Probably 3–4 commits.

### Questions for Travis before building
1. Should past sets be kept and viewable (a history of what was sung each week), or should only the latest set be kept?
2. Should other leaders be able to see or edit the set, or only the person who made it?
3. Should viewers see anything of the set (for example, "Next song: …" at the bottom of their screen), or nothing?
4. At the end of a song, should Next go straight to the next song in the set (as proposed), or pause on a blank or title slide first?
