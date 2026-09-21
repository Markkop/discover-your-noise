# Spotify playlist — Obscura browser extraction

Use after `discover-your-noise.mjs` exits with `Action needed` (incomplete public
HTML).

## Workflow

1. `browser_navigate` → playlist URL (`waitUntil`: `networkidle0` or `load`).
2. `browser_evaluate` → read expected track count (see script below).
3. Loop: evaluate collect script → `browser_scroll` down → repeat until
   `captured === expected` or two passes add zero tracks.
4. Write JSON handoff (see main SKILL.md) → `from-browser` command.

## Read expected track count

```javascript
(() => {
  const desc = document.querySelector('meta[name="description"]')?.content
    ?? document.querySelector('meta[property="og:description"]')?.content
    ?? "";
  const m = desc.match(/\b([\d,]+)\s+(?:items|songs)\b/i);
  const title = document.querySelector('meta[property="og:title"]')?.content
    ?? document.title;
  return {
    title,
    expectedTrackCount: m ? parseInt(m[1].replace(/,/g, ""), 10) : null,
    url: location.href,
  };
})()
```

If `expectedTrackCount` is null, stop and report — do not guess.

## Collect tracks (virtualized list)

Run repeatedly; merge results in agent memory or accumulate inside one long
evaluate. Spotify DOM changes — adjust selectors if rows are empty.

```javascript
(() => {
  const tracks = new Map();
  const rowSel = '[data-testid="tracklist-row"], [data-testid="playlist-track"]';
  const scrollEl = document.querySelector('[data-testid="playlist-tracklist"]')
    ?? document.querySelector('main')
    ?? document.documentElement;

  for (const row of document.querySelectorAll(rowSel)) {
    const trackLink = row.querySelector('a[href*="/track/"]');
    if (!trackLink) continue;
    const idMatch = trackLink.href.match(/\/track\/([A-Za-z0-9]{22})/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const artists = [];
    for (const a of row.querySelectorAll('a[href*="/artist/"]')) {
      const am = a.href.match(/\/artist\/([A-Za-z0-9]{22})/);
      if (am) artists.push({ id: am[1], name: (a.textContent || "").trim() });
    }
    if (!tracks.has(id)) tracks.set(id, { id, artists });
  }

  scrollEl.scrollBy(0, Math.max(600, window.innerHeight * 0.8));
  return {
    captured: tracks.size,
    tracks: [...tracks.values()],
    scrollTop: scrollEl.scrollTop,
    scrollHeight: scrollEl.scrollHeight,
  };
})()
```

Between evaluate calls, keep a running `Map` keyed by track ID in the agent — do
not discard tracks when the DOM virtualizes them away.

## Stop conditions

- **Done:** `captured === expectedTrackCount`.
- **Stuck:** two consecutive passes with `captured` unchanged and
  `captured < expectedTrackCount` → report partial count; do not run
  `from-browser`.
- **Scroll end:** `scrollTop + clientHeight >= scrollHeight - 4` and still short →
  one more pass, then report partial if still short.

## Handoff validation

The helper rejects incomplete JSON. Every track needs:

- `id`: 22-char Spotify track ID
- `artists`: array of `{ id, name }` with 22-char artist IDs from `/artist/` links

Deduplicate artists per track; the helper deduplicates across the playlist for
genre counting.
