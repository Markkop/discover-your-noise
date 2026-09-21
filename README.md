# Discover Your Noise

Discover the genres represented in a Spotify playlist. The project is both a
zero-dependency Node.js command and a portable agent skill for Codex, Cursor,
Claude Code, and DeepSeek Harness.

The first runnable version supports public playlists. It does not require a
Spotify API key. For playlists longer than Spotify's public HTML snapshot, the
skill detects the incomplete result and guides a browser-capable agent through
collecting the remaining tracks.

## Try it

Requires Node.js 20 or newer.

```bash
npm start -- https://open.spotify.com/playlist/76yxaCsawHQZuuVQgSGlvG
```

The report distinguishes direct Every Noise classifications, genres inferred
from related artists, and artists that remain unmapped.

## Use it as a skill

The canonical skill lives at
`.agents/skills/discover-your-noise/SKILL.md`, which is discovered directly by
Cursor, Codex, and DeepSeek Harness when this repository is open.

For Claude Code, copy the skill directory into the project skill location:

```bash
mkdir -p .claude/skills
cp -R .agents/skills/discover-your-noise .claude/skills/
```

Then ask your agent to discover the genres in a Spotify playlist and provide
the playlist URL.

## Current boundary

Private playlists and saved-library analysis require Spotify user OAuth. That
flow is intentionally not part of the first trial and will be added after the
public/browser workflow is exercised with real playlists.
