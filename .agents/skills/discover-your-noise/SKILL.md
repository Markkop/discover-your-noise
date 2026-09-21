---
name: discover-your-noise
description: >-
  Analyze a Spotify playlist for Every Noise genres using Obscura for browser
  extraction and optional Spotify OAuth for private playlists. Use when the user
  asks what genres are in a Spotify playlist, wants Discover Your Noise, needs
  Obscura browser setup, or Spotify playlist analysis with Every Noise.
---

# Discover Your Noise

Skill root: the directory that contains this `SKILL.md`.

Run the bundled Node helper for classification and reporting. Use **Obscura** for
browser work when the public HTML is incomplete. Use **on-demand-spotify-provider**
only for private playlists or Web API access — never for a public playlist.

## Decision tree

```
User gives a Spotify playlist URL
  │
  ├─ Run discover-your-noise.mjs (always first)
  │
  ├─ Success → return the report
  │
  ├─ Exit 2 (Action needed: browser) → Obscura browser extraction → from-browser
  │
  └─ HTTP 401/403 or "private" → on-demand-spotify-provider → Spotify Web API
       (not implemented in the helper yet; state the boundary and stop)
```

## Step 1 — Classify without credentials

```bash
node "$SKILL_ROOT/scripts/discover-your-noise.mjs" "<spotify-playlist-url>"
```

- Exit `0`: return the report. Explain direct, inferred, and unmapped coverage when
  it materially affects the result.
- Exit `2` (`Action needed`): continue to Step 2. Do not ask for a Spotify API key.
- Other exit: report the error.

## Step 2 — Install and verify Obscura

Follow [references/obscura.md](references/obscura.md). Summary:

1. Detect OS/arch (`uname -s`, `uname -m`).
2. Download the latest release binary if `obscura` is not on `PATH`.
3. Confirm: `obscura fetch https://example.com --eval "document.title"` prints
   `Example Domain` (or equivalent).

Prefer Obscura over the IDE's built-in browser so the workflow is portable across
Cursor, Codex, Claude Code, and CI.

### Connect Obscura to the agent

**stdio (local, recommended):** ensure `obscura mcp` is available — either as an
MCP server in the client config, or by invoking Obscura MCP tools if already
wired. See references/obscura.md for Cursor/Claude Desktop config.

**HTTP (self-hosted):** `obscura mcp --http --host 0.0.0.0 --port 3000` behind
loopback or a token-protected tunnel. Set `OBSCURA_MCP_TOKEN` when not on
127.0.0.1.

Use `--stealth` when Spotify blocks or fingerprints a plain client. Stealth
requires a native binary built with the stealth feature; the default Docker image
does not include it.

## Step 3 — Browser extraction (long public playlists)

Spotify's public HTML often lists only ~30 tracks. The page virtualizes rows while
scrolling — **retain track IDs in memory** even after rows leave the DOM.

1. `browser_navigate` to the playlist URL. Wait until the track list is visible
   (`waitUntil`: `networkidle0` or `load`).
2. Read the declared song count from page metadata or visible UI.
3. Run the scroll-and-collect recipe in
   [references/browser-extraction.md](references/browser-extraction.md) via
   `browser_evaluate`. Use `browser_scroll` between passes if evaluate alone is
   insufficient.
4. Stop when `distinct track IDs === expectedTrackCount`. If two final passes add
   zero tracks and counts still differ, report the partial count — do not analyze.
5. Write a temporary UTF-8 JSON file:

```json
{
  "playlist": {
    "url": "https://open.spotify.com/playlist/...",
    "title": "Playlist title",
    "expectedTrackCount": 50
  },
  "tracks": [
    {
      "id": "spotify-track-id",
      "artists": [{ "id": "spotify-artist-id", "name": "Artist" }]
    }
  ]
}
```

6. Finish:

```bash
node "$SKILL_ROOT/scripts/discover-your-noise.mjs" from-browser "<json-path>"
```

Return the report. Delete the temp JSON when done unless the user asks to keep it.

## Step 4 — Spotify connection (private playlists only)

Public playlists: **do not** start OAuth or ask for Client ID/secret.

Private playlists or saved-library analysis: follow
[references/spotify-connection.md](references/spotify-connection.md) using the
`on-demand-spotify-provider` skill. The bundled helper does not yet consume Web API
playlist data — if OAuth succeeds but the helper cannot proceed, state that
boundary clearly instead of improvising.

## Agent behavior

### Always

- Run the Node helper first; never skip straight to browser scraping.
- Count each unique credited artist once per playlist (including collaborators).
- Never silently analyze a partial playlist.
- Treat Every Noise as a historical snapshot; unmapped artists are coverage gaps,
  not proof of no genre.
- Never print Spotify client secrets, access tokens, or refresh tokens in chat.

### Never

- Hand-roll OAuth, redirect URIs, or token exchange (use on-demand-spotify-provider).
- Commit credential files (`.env`, `credentials.json`).
- Expose Obscura MCP HTTP on a public IP without `OBSCURA_MCP_TOKEN` and network
  isolation.
- Use `everynoise.com/lookup.cgi` (returns 403).

### Reporting

Lead with genres sorted by artist count when the user only asked for genres. For
the full Discover Your Noise report, return the helper's formatted output. Mention
browser extraction or OAuth only when those steps were required.

## References

- [obscura.md](references/obscura.md) — download, MCP, Docker, stealth, security
- [browser-extraction.md](references/browser-extraction.md) — Spotify scroll recipe
- [spotify-connection.md](references/spotify-connection.md) — OAuth when needed
