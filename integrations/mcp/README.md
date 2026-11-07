# Patzer MCP bridge (private, self-hosted)

This additive integration uses Patzer's existing authenticated API. **No Patzer source edits, DB migrations, or existing tunnel reconfiguration.** It contains eight MCP tools: `list_games`, `get_game`, `analyze_game`, `analyze_position`, `get_game_review`, `generate_game_review`, `import_chesscom_games`, `import_lichess_games`.

## 1. Start Patzer

The historical local installation may be at `~/projects/my-creations/chess/patzer`; its `data/chess.db` is **not part of the fork** and should not be overwritten. In that original checkout run `npm run dev` (server on port 8800, web on port 5173). Or run a dedicated Patzer deployment with your own backed-up data; don't run competing processes writing the same SQLite DB.

## 2. Configure and start the bridge

From this new fork:

```sh
cd ~/projects/my-creations/chess/patzer-mcp
cp integrations/mcp/.env.example integrations/mcp/.env
chmod 600 integrations/mcp/.env
# Edit .env locally: Patzer account username, password, and a new random MCP_API_KEY
# Generate a key with: openssl rand -hex 32
set -a; . ./integrations/mcp/.env; set +a
node integrations/mcp/server.mjs
```

The bridge listens on **127.0.0.1:8811** and enforces a constant-time Bearer key comparison before any MCP operation. It logs no credentials. Patzer credentials remain local to the host and are exchanged for a session cookie against its API. Account access is scoped by Patzer itself. If changing login credentials, restart the bridge. Keep `integrations/mcp/.env` private.

Verify locally (in another terminal):

```sh
curl -sS http://127.0.0.1:8811/healthz
curl -sS -H "Authorization: Bearer $MCP_API_KEY" -H 'Content-Type: application/json' -H 'Accept: application/json,text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://127.0.0.1:8811/mcp
```

A local `healthz` response confirms only that the bridge process is up; it does not confirm the Patzer login. `list_games` tests the actual connection.

## 3. Expose a separate HTTPS tunnel with Tailscale Funnel

**Do not overwrite the existing Chat On Steroids funnel on HTTPS 443.** Tailscale Funnel supports additional HTTPS ports, including 8443 (subject to your version and tailnet configuration). The independently authenticated MCP bridge may be exposed on its own port:

```sh
tailscale funnel --bg --https=8443 http://127.0.0.1:8811
tailscale funnel status
```

Expected new URL shape: `https://YOUR-TAILSCALE-FUNNEL-HOST:8443/mcp`. This is publicly reachable over HTTPS even though the local process is loopback-only. **Anyone on the internet can attempt to contact it**; only callers with your API key should pass authorization. Use a fresh 64-hex-character key, never publish it in GitHub or a chat message, and rotate it if exposed. Funnel on port 8443 can be stopped without removing the existing HTTPS 443 endpoint:

```sh
tailscale funnel --https=8443 off
```

Check your installed Tailscale CLI's behavior before applying any commands to an existing endpoint. Leave the original gateway and Caddy settings unchanged.

## 4. Make a ChatGPT plugin configuration

With the live URL in hand, from the fork run:

```sh
node integrations/mcp/scripts/build-plugin.mjs 'https://YOUR-TAILSCALE-FUNNEL-HOST:8443/mcp'
cd integrations/mcp/dist-plugin
zip -r patzer-chess-review.zip patzer-chess-review
```

In ChatGPT use **Settings → Plugins** (or the Plugins sidebar) → create/import plugin from ZIP if available, and supply the generated archive. The portable `mcp.json` declares a `streamable-http` endpoint and **API-key Bearer authentication**. When connecting, enter the secret key through ChatGPT's connection/credential UI, **not** the plugin manifest or chat. A plugin package never starts the Patzer process, creates a tunnel, or stores its secrets automatically. Confirm the plugin shows `list_games` and that a real call succeeds.

If your ChatGPT client does not offer ZIP import, create a private plugin through the available plugin creator flow with the same archive. Some accounts require a workspace admin to permit custom plugins. Do not choose **no authentication** on an internet-exposed MCP server.

## 5. Test and limitations

```sh
node --test integrations/mcp/test.mjs
```

The bridge is intentionally separate from your installed Patzer checkout and has no access to the SQLite DB directly. It supports JSON responses to MCP Streamable HTTP `POST`, no resource subscriptions or server-side streaming. Review prose is collected from Patzer's SSE stream and delivered in one JSON tool result, so long reviews can take time. The server only supports single JSON-RPC messages rather than batches. Patzer must remain running; review generation requires a configured Patzer LLM; Stockfish calls consume CPU. The game list returns the newest up to 100 games; Patzer's current list route does not implement offset pagination.

Security: no unauthenticated tool calls; localhost binding by default; password stays on host; network API key entered only in connection UI; separate tunnel, no changes to Chat On Steroids. Future hardening for wider multi-user use should add OAuth, audited per-user tokens, rate limiting and request limits at a reverse proxy.
