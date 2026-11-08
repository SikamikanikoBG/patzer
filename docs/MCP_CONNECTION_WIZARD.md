# Patzer → ChatGPT: one-time MCP connection wizard

The Patzer fork includes **Admin → ChatGPT / MCP** at `http://localhost:8800/admin/mcp`.

## Setup

1. Log in to Patzer as administrator. Local MCP administration only works with `HOST=127.0.0.1` (or another loopback address). Public/remote Patzer deployments cannot configure a tunnel through the browser.
2. Open **Admin → ChatGPT / MCP**. The page detects existing local credentials, the OpenAI tunnel ID and whether the local tunnel runtime is installed; it never returns any saved API key or Patzer password.
3. Open [OpenAI Platform → Tunnels](https://platform.openai.com/settings/organization/tunnels) and create or reuse a tunnel associated with the intended ChatGPT workspace. Paste its `tunnel_...` ID into the wizard.
4. Create an **OpenAI Platform runtime API key** with Tunnels **Read + Use**, using the same Platform organization. Paste the key into the wizard **once**. This key is not your ChatGPT password and is not the Patzer API password. Leave the field blank in future edits to keep the existing key.
5. If asked, enter your Patzer password; the app checks it against the signed-in administrator account and saves only local credential files. This isn't needed if the existing MCP bridge was already configured.
6. Keep **Connect automatically when I log in** selected, then click **Save & connect**.
7. Wait for **Tunnel connected**. The page polls every 5 seconds and distinguishes the systemd service state from OpenAI control-plane readiness. Use **Test Patzer MCP** to verify local game access.
8. In your personal ChatGPT workspace, add or select the custom MCP integration using the same tunnel ID and no extra MCP authentication. Existing ChatGPT plugin installations do not have to be reinstalled. Try “List my latest 5 games in Patzer.”

Once configured, the tunnel automatically starts on user login, restarts after failure and no terminal commands or Chat On Steroids are necessary. Stop/start it from the wizard at any time.

## Connection status and limits

- **Local MCP credentials**: private `.env` and Patzer password file are present. Test Patzer MCP for actual authentication.
- **Runtime key**: private local key file exists. The actual value is never sent to the browser.
- **Service active**: a systemd user service is running, but it may still be reconnecting or failing authentication.
- **Tunnel connected**: the official `tunnel-client health --require-control-plane-poll` confirms readiness and a successful poll to OpenAI. This does **not** prove the plugin has been installed, selected, or granted permissions in ChatGPT. Test via ChatGPT itself.
- The wizard cannot generate or retrieve Platform API keys, grant Platform tunnel permissions, enable ChatGPT plugin access or validate a separate personal ChatGPT account's plugin installation.
- Local MCP requests still use the existing Patzer account and Stockfish; AI coach prose continues to require an Ollama/vLLM backend configured separately.

## Security model

The app creates a **localhost-only** admin control endpoint; it does not expose an unauthenticated HTTP MCP port. API endpoints require a Patzer **administrator session** and the existing `X-Requested-With: patzer` CSRF header for mutations. Credential files are created with mode `0600`, their directory with mode `0700`, and excluded from Git. No secrets are committed or returned by status APIs. Commands are invoked with fixed argument arrays, not a shell. The tunnel establishes an **outbound** connection and the user-service health listener is bound to `127.0.0.1` only.

On the audited Pop!_OS install, it creates `~/.config/patzer-mcp/tunnel.env`, `~/.config/tunnel-client/patzer.yaml` and `~/.config/systemd/user/patzer-mcp-tunnel.service`. The tunnel runs in your user session, not as root. The key file contains plaintext protected by file permissions, not hardware encryption. Anyone with full access to the same OS user can access it.

## Diagnostics

```bash
systemctl --user status patzer.service
systemctl --user status patzer-mcp-tunnel.service
~/.local/bin/tunnel-client health --url http://127.0.0.1:8895 --require-control-plane-poll --json
journalctl --user -u patzer-mcp-tunnel.service -n 30 --no-pager
```

If you want to remove the auto-start daemon, use `systemctl --user disable --now patzer-mcp-tunnel.service`.

**Important**: `systemctl --user` is available on Linux systemd installations; this wizard intentionally does not support Windows or Docker. The pre-existing MCP stdio bridge still works through manual setup on those systems.
