# Place

Find where you stopped reading, and send it to the e-ink devices.

A one-screen PWA. Pick a book, type a few words from where you stopped, and it
resolves that to a real position and pushes it to the Xteink X4 (and the
reMarkable) over kosync.

## Why this exists

The reading stack spans an Xteink X4, a reMarkable, a Kindle, and Audiobookshelf.
Three of those four can report and receive a reading position automatically.

**The Kindle cannot do either.** There is no API to read a position off it and
none to push one to it — not for personal documents, in either direction. So the
whole system has exactly one manual input: *"here is where I stopped."* This app
is that input, and everything downstream is derived from it.

## How it works

The app is served over HTTPS while the sync server and the ebook library are
plain HTTP on the LAN, so the browser cannot call them directly (mixed content).
Instead the app writes a row to `reading_sync_requests` in the shared suite
Supabase project, and `reading-sync` on the Beelink resolves it and pushes the
result back into the row. Same outbox shape the rest of the suite uses.

The box-side half lives in the `beelink-config` repo under `apps/reading-sync/`.

```
type a few words
   -> reading_sync_requests row
   -> poller resolves it against the EPUB
   -> kosync position   (X4 + reMarkable)
   -> result written back for this app to show
```

## Two things that look like bugs and are not

**The two percentages differ, sometimes wildly.** The app shows you *"90% through
the book"* but tells the X4's slider *"set it to 68%"*. Those are different
rulers: the human number is a fraction of visible text, while the device weights
by uncompressed file bytes including markup. On a markup-heavy book with dense
endnotes they diverge by a fifth of the book. Showing one number for both would
send you to the wrong chapter.

**The X4 does not sync by itself.** It keeps its Wi-Fi powered down except during
an explicit sync, so a pushed position only lands when you open the book and
choose Reader Menu → Sync Progress. That is a firmware power decision, not
something this app can work around — which is why every result also includes a
manual route (chapter + percent slider + a line of text to look for) for when the
X4 has no Wi-Fi at all.

## Local dev

```
cp .env.example .env      # same suite Supabase project as Cue/Today/Tide
npm install
npm run dev
```

## Deploy

GitHub Pages via Actions on push to `main`. Needs repo secrets
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and `build:gh-pages` expects
the repo to be named `Reading-App` (otherwise update `BASE_URL` in
`package.json`).
