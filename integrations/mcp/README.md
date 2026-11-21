# Patzer MCP integration: audited connection guide

**Status:** Patzer API + Stockfish integration tested against an isolated real Patzer instance. OpenAI Secure MCP Tunnel and ChatGPT installation **not yet provisioned or tested**, and remain dependent on an actual Platform `tunnel_id`, runtime key, workspace permissions, and Patzer credentials.

## Architecture and current limitations

Patzer's existing API is cookie-authenticated and is not natively an MCP server. This fork adds two separate transports for the same eight tools:

- **`stdio.mjs` (recommended for ChatGPT):** A stdio MCP process that OpenAI `tunnel-client` launches locally, using OpenAI Secure MCP Tunnel. No inbound TCP port or Tailscale Funnel is needed.
- **`server.mjs` (local debugging and clients supporting arbitrary headers):** HTTP Streamable MCP, loopback-only at 127.0.0.1:8811, requiring a 32+ character `MCP_API_KEY` Bearer token. **Do not use this as a direct ChatGPT web connection:** ChatGPT does not present custom API keys to third-party MCP services. This transport must not be exposed via an unauthenticated public proxy.

Both transports authenticate to Patzer through `/api/auth/login` using locally configured Patzer credentials. They access games only through Patzer's existing account-scoped API. Neither reads or modifies your historical `data/chess.db` directly. No database migrations or original gateway changes.

### Available tools

`list_games`, `get_game`, `analyze_game`, `analyze_position`, `get_game_review`, `generate_game_review`, `import_chesscom_games`, `import_lichess_games`.

Importing games and generating reviews create/modify Patzer records. Stockfish analysis caches results and uses CPU; generating AI prose requires a separately configured LLM in Patzer. Patzer's current `/api/games` endpoint has no offset pagination: this integration retrieves only the most recent 100 games.

## 1. Start the existing Patzer app (your real database)

Use the **historical original checkout**, not the fork (the fork does not include your saved games):

```sh
cd ~/projects/my-creations/chess/patzer
HOST=127.0.0.1 npm run dev
```

The API is at `http://127.0.0.1:8800`; web development UI at `http://127.0.0.1:5173`. Before setting up the tunnel, verify `http://127.0.0.1:8800/api/health` responds. Do not start two Patzer servers pointing to the same SQLite database. The `HOST=127.0.0.1` override matters because Patzer's API defaults to `0.0.0.0` (all network interfaces).

## 2. Configure Patzer credentials locally

```sh
cd ~/projects/my-creations/chess/patzer-mcp
bash integrations/mcp/scripts/configure-local.sh
```

The script prompts for your existing Patzer username and password directly in your local terminal, **hides password input**, stores the password separately in a mode-600 local file, writes an untracked `.env` pointing to it, then calls `list_games` through the actual Patzer API. You never need to send credentials to ChatGPT, pass passwords in CLI arguments, or source `.env` as a shell script. To change the credentials, run the script again.


Node.js 22+ is required by this integration. The bridge refuses to send the Patzer password to a non-loopback `PATZER_URL` by default. If Patzer runs on another machine, review the network and TLS requirements first; `PATZER_ALLOW_REMOTE=true` explicitly overrides this guard.

Verify the process itself without a public tunnel:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"cli-test","version":"1"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node integrations/mcp/stdio.mjs
```

`tools/list` alone confirms MCP protocol discovery, not Patzer login; call `list_games` to verify Patzer credentials and API reachability.

## 3. Create a private OpenAI Secure MCP Tunnel (recommended)

Follow OpenAI's current documentation: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels and https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md .

Requirements: a Platform `tunnel_id`, a limited-scope Platform runtime API key, and permission **Tunnels Read + Use**; tunnel creation requires **Tunnels Read + Manage**. The tunnel must be associated with the intended ChatGPT workspace. A **Business** workspace only allows admins/owners to create custom MCP plugins; Enterprise/Edu allow authorized developers according to workspace RBAC. Verify those permissions before proceeding.

On the audited Pop!_OS machine, I installed OpenAI `tunnel-client` v0.0.20 at `~/.local/bin/tunnel-client` from the official release and verified its published SHA-256 checksum. If using another machine, download the current supported binary from the official Platform tunnel settings or https://github.com/openai/tunnel-client/releases/latest. Check its local help:

```sh
tunnel-client help quickstart
```

Create a tunnel in https://platform.openai.com/ settings, then from your own terminal (the stdio process automatically loads the local Patzer `.env`) enter the runtime key securely without committing it:

```sh
read -rs -p 'Platform tunnel runtime key: ' CONTROL_PLANE_API_KEY; echo
export CONTROL_PLANE_API_KEY
# Substitute your own real tunnel_ ID (never use an example as a real ID).
tunnel-client init --sample sample_mcp_stdio_local --profile patzer --tunnel-id 'tunnel_YOUR_REAL_ID' --mcp-command '/home/mousa/.local/share/pnpm/bin/node /home/mousa/projects/my-creations/chess/patzer-mcp/integrations/mcp/stdio.mjs'
tunnel-client doctor --profile patzer --explain
tunnel-client run --profile patzer
```

`stdio.mjs` is a **local process**. OpenAI's tunnel-client calls it through stdio; it does not use a public URL. Keep this process running during ChatGPT tool discovery/calls. The tunnel client's runtime key should be restricted, retained locally and never shared in chat. For long-term persistence, configure it as a user service with a suitable system credential store and least-privileged user; do not store an unrestricted API key in a public service file.

## 4. Add Patzer to ChatGPT Plugins

Use ChatGPT on the web: **Plugins → + → Add custom MCP server → Connection: Tunnel**. Select the verified tunnel or enter its exact `tunnel_id`, choose **No authentication** for the *MCP service* (the tunnel itself is protected by the separate OpenAI runtime key and workspace association), review the risk warning, then create/install the private plugin. Discover tools and call `list_games` before claiming success.

If your workspace does not permit creating custom MCP connections, request permission from its admin/owner. This cannot be bypassed by uploading a ZIP or pointing ChatGPT at Tailscale. Optional advanced plugin packaging, once you have a **real tunnel ID**:

```sh
node integrations/mcp/scripts/build-plugin.mjs tunnel_YOUR_REAL_ID
cd integrations/mcp/dist-plugin
zip -r patzer-chess-review.zip patzer-chess-review
```

The generated ZIP declares `extensions.com.openai.tunnelId` and `auth.type=none`; it contains no key. ChatGPT's direct Add custom MCP server flow is simpler and preferred when available. **Do not reuse the old `:8443/mcp` ZIP**: it was never connected and relied on unsupported API-key auth.

## 5. Tests and support boundaries

```sh
node --test integrations/mcp/test.mjs
node integrations/mcp/integration-real.mjs
```

`integration-real.mjs` launches the source Patzer app with a new **temporary database**, creates a disposable test account/game, and confirms API login, Stockfish position and game analysis, cached game review, and the expected no-LLM error. It never touches your original database. Pass `PATZER_SOURCE=/path/to/installed/patzer` if your checkout is elsewhere.

A real AI-coach generation requires a configured Ollama/vLLM server and remains untested. OpenAI tunnel-client transport, ChatGPT installation, and authenticated calls from ChatGPT remain untested until provisioned. The existing Tailscale Funnel `https://pop-os.tail809c0b.ts.net` / Chat On Steroids gateway has not been changed.

## Why not reuse the public Tailscale Funnel directly?

As of November 2026 ChatGPT custom MCP connections support OAuth/no-auth, not arbitrary API-key headers. A public Funnel exposing the HTTP bridge with only a Bearer-key requirement will **not connect to ChatGPT web**. Exposing it without authentication would be dangerous. A public-facing production endpoint would need OAuth 2.1 and associated authorization flow, which is not implemented by this bridge. The private Secure MCP Tunnel avoids a new public ingress entirely.

## Current installation status on the audited machine

- Existing original Patzer production server: **running** via `systemctl --user status patzer.service`, serving `http://localhost:8800`, binding **127.0.0.1:8800**. Service auto-starts in the user's systemd session.
- Existing chess database: 21 games and 13 analyses at the time of setup. Verified SQLite backup created in the original installation's `data/backups/` directory before starting the service.
- `tunnel-client`: v0.0.20 installed at `~/.local/bin/tunnel-client` with official SHA256SUMS check passing.
- MCP source and tests: present at `~/projects/my-creations/chess/patzer-mcp/integrations/mcp/`; stdio transport works with MCP Inspector.
- **Still not connected to ChatGPT**: no local Patzer credentials `.env`, no Platform tunnel ID or runtime key, and no live ChatGPT plugin setup. Do not expose the HTTP bridge publicly to bypass this.
- Existing Chat On Steroids Tailscale gateway remains unchanged.

### Patzer website MCP wizard

On a localhost-only Linux/systemd installation, you can now configure and manage
this tunnel directly from Patzer **Admin → ChatGPT / MCP**. The wizard stores
runtime credentials once in a mode-600 local file, manages a persistent user
service, and polls real control-plane tunnel readiness. See
[`docs/MCP_CONNECTION_WIZARD.md`](../../docs/MCP_CONNECTION_WIZARD.md).
