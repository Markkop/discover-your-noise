# Obscura — install and agent connection

Official project: https://github.com/h4ckf0r0day/obscura  
Docs: https://docs.obscura.sh

Obscura is a Rust headless browser (V8, CDP, MCP). No Chrome or Node required.

## Install binary

Detect platform, then download from the latest
[GitHub release](https://github.com/h4ckf0r0day/obscura/releases):

| OS | Arch | Archive |
|----|------|---------|
| Darwin | arm64 | `obscura-aarch64-macos.tar.gz` |
| Darwin | x86_64 | `obscura-x86_64-macos.tar.gz` |
| Linux | x86_64 | `obscura-x86_64-linux.tar.gz` |
| Linux | arm64 | `obscura-aarch64-linux.tar.gz` |

For anti-detection (recommended for Spotify), use a `-stealth` archive or build
with `--features render,stealth`.

```bash
# Example: macOS Apple Silicon
OBSCURA_VERSION="${OBSCURA_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"
curl -fsSL "https://github.com/h4ckf0r0day/obscura/releases/${OBSCURA_VERSION}/download/obscura-aarch64-macos.tar.gz" \
  | tar xz -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/obscura"
export PATH="$INSTALL_DIR:$PATH"
obscura fetch https://example.com --eval "document.title"
```

Keep `obscura` and `obscura-worker` in the same directory when using `scrape`.

## Verify

```bash
obscura fetch https://example.com --eval "document.title"
# expect: Example Domain
```

## MCP — stdio (local agents)

Start for subprocess-based clients:

```bash
obscura mcp
# with stealth:
obscura --stealth mcp
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "obscura": {
      "command": "/path/to/obscura",
      "args": ["mcp", "--stealth"]
    }
  }
}
```

Restart the client after editing. Tools appear as `browser_navigate`,
`browser_evaluate`, `browser_scroll`, `browser_snapshot`, etc.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) — same
shape as Cursor.

### Claude Code

```bash
claude mcp add obscura /path/to/obscura mcp --stealth
```

## MCP — HTTP (self-hosted)

For a VPS or shared agent host:

```bash
export OBSCURA_MCP_TOKEN="$(openssl rand -hex 32)"
obscura mcp --http --host 0.0.0.0 --port 3000
# endpoint: http://127.0.0.1:3000/mcp
# header: Authorization: Bearer $OBSCURA_MCP_TOKEN
```

Non-loopback binds **require** `OBSCURA_MCP_TOKEN` (≥32 bytes). Keep the port off
the public internet; use SSH tunnel or internal Docker network.

### Docker

```bash
# CDP (for puppeteer-core scripts)
docker run -d --name obscura -p 127.0.0.1:9222:9222 h4ckf0r0day/obscura

# MCP HTTP
docker run -d --name obscura-mcp -p 127.0.0.1:3000:3000 \
  -e OBSCURA_MCP_TOKEN="$(openssl rand -hex 32)" \
  h4ckf0r0day/obscura mcp --http --host 0.0.0.0 --port 3000
```

Docker images do not include stealth today. Build from source for `--stealth` in
containers.

## Tools used by this skill

| Tool | Use |
|------|-----|
| `browser_navigate` | Open playlist URL |
| `browser_evaluate` | Run scroll/collect JavaScript |
| `browser_scroll` | Advance virtualized list |
| `browser_snapshot` | Debug page state between passes |
| `browser_wait_for` | Wait for track list selector |
| `browser_close` | Reset session when finished |

Take a fresh snapshot after navigation or scroll before clicking — element refs
go stale.

## Security

- MCP HTTP exposes a live browser. Use token + loopback or VPN.
- Set `OBSCURA_MCP_ALLOWED_ORIGINS` if browser pages could reach the MCP port.
- Do not bind `0.0.0.0` on a public IP without auth.
