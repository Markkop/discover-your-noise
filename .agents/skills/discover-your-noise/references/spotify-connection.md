# Spotify connection (private playlists)

**Public playlists:** no OAuth. The Node helper fetches public HTML directly.

**Private playlists, library, or Web API:** use the `on-demand-spotify-provider`
skill. Do not hand-roll OAuth.

Skill location: `~/.cursor/skills/on-demand-spotify-provider` (or copy into the
project's `.claude/skills/` for Claude Code).

## Check existing credentials

```bash
python3 ~/.cursor/skills/on-demand-spotify-provider/scripts/serve.py --check
```

Output is JSON with `status`: `ready` | `expired` | `missing`. Never print token
or secret values to the user.

## Refresh expired tokens

```bash
python3 ~/.cursor/skills/on-demand-spotify-provider/scripts/serve.py --refresh
```

## New login

```bash
python3 ~/.cursor/skills/on-demand-spotify-provider/scripts/serve.py \
  --scopes "playlist-read-private playlist-read-collaborative user-read-private"
```

Optional: `--env-file "$PROJECT_ROOT/.env"` to write env vars (never commit).

Wait until stdout shows `SPOTIFY_PROVIDER_READY` or `SPOTIFY_PROVIDER_FAILED`.

Tell the user:

- Setup URL (loopback only)
- Exact Redirect URI for the Spotify Dashboard (`http://127.0.0.1:<port>/callback` —
  never `localhost`)
- Credential path (`~/.config/on-demand-spotify-provider/credentials.json`)
- Spotify display name and granted scopes

Do **not** paste Client Secret, access token, or refresh token in chat.

## Invariants

- Redirect URI must use `127.0.0.1`, not `localhost`.
- Server binds `127.0.0.1` only — never `0.0.0.0`.
- Default port `18764`; if taken, the script picks another — user must update the
  Dashboard allowlist.
- Credentials file mode `0600`.

## After setup

Call Spotify Web API with `Authorization: Bearer <access_token>`. On 401, run
`--refresh` once and retry.

Env var names (unless the project defines others):

```
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REDIRECT_URI
SPOTIFY_ACCESS_TOKEN
SPOTIFY_REFRESH_TOKEN
```

## Boundary in Discover Your Noise

The bundled `discover-your-noise.mjs` does not yet analyze private playlists via
the Web API. If OAuth succeeds but the helper cannot proceed, tell the user that
private-playlist support is planned and stop — do not improvise a parallel
implementation unless explicitly asked to build it.
