/** Patzer's strictly-local OpenAI Secure MCP Tunnel controller.
 *
 * The MCP bridge uses stdio. There is no public HTTP MCP port or remote
 * command execution endpoint. The web routes calling this module are
 * authenticated, admin-only, same-origin and restricted to localhost.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';

const exec = promisify(execFile);
const SERVICE = 'patzer-mcp-tunnel.service';
const HEALTH_URL = 'http://127.0.0.1:8895';
const TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;
const API_KEY_PATTERN = /^[a-zA-Z0-9._-]{12,512}$/;

function paths() {
  const home = homedir();
  const controlDir = join(home, '.config', 'patzer-mcp');
  const bridgeDir = join(config.projectRoot, 'integrations', 'mcp');
  return {
    client: join(home, '.local', 'bin', 'tunnel-client'),
    profile: join(home, '.config', 'tunnel-client', 'patzer.yaml'),
    unit: join(home, '.config', 'systemd', 'user', SERVICE),
    key: join(controlDir, 'tunnel.env'),
    controlDir,
    bridgeDir,
    stdio: join(bridgeDir, 'stdio.mjs'),
    mcpEnv: join(bridgeDir, '.env'),
    patzerPassword: join(bridgeDir, '.patzer-password'),
  };
}

/** Permission checks matter: an accidentally world-readable runtime key is not configured. */
function privateFile(path: string) {
  try { const s = lstatSync(path); return s.isFile() && (s.mode & 0o077) === 0; }
  catch { return false; }
}

function atomicPrivateWrite(file: string, data: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } finally {
    if (existsSync(tmp)) {
      // An interrupted failed write must not remain in a world-visible place.
      unlinkSync(tmp);
    }
  }
}

export function validateTunnelId(id: string): boolean { return TUNNEL_ID_PATTERN.test(id); }
export function validateRuntimeKey(value: string): boolean { return API_KEY_PATTERN.test(value); }

function profileTunnelId(): string | null {
  try {
    const raw = readFileSync(paths().profile, 'utf8');
    return raw.match(/^\s*tunnel_id:\s*["']?(tunnel_[0-9a-f]{32})["']?\s*$/m)?.[1] ?? null;
  } catch { return null; }
}

async function systemctl(...args: string[]): Promise<string> {
  const { stdout } = await exec('systemctl', ['--user', ...args], { timeout: 12000, maxBuffer: 65536 });
  return stdout.trim();
}
async function unitProperty(prop: string): Promise<string> {
  try { return (await systemctl('show', SERVICE, `--property=${prop}`, '--value')).trim(); }
  catch { return ''; }
}

/** Require a successful control-plane poll, not merely a listening local port. */
async function liveTunnelHealth(client: string) {
  if (!existsSync(client)) return { health: false, connected: false };
  try {
    const { stdout } = await exec(client, [
      'health', '--url', HEALTH_URL, '--json', '--require-control-plane-poll',
    ], { timeout: 6500, maxBuffer: 16000 });
    const result = JSON.parse(stdout) as {
      healthz?: { ok?: boolean };
      readyz?: { ok?: boolean };
      control_plane_poll?: { ok?: boolean };
      result?: string;
    };
    return { health: result.healthz?.ok === true, connected: result.result === 'pass' && result.readyz?.ok === true && result.control_plane_poll?.ok === true };
  } catch {
    // Client's health subcommand exits non-zero when a control-plane check fails.
    // Preserve the distinction between an unhealthy connection and a running unit.
    return { health: false, connected: false };
  }
}

export interface TunnelStatus {
  available: boolean;
  tunnelClientInstalled: boolean;
  localMcpCredentialsSaved: boolean;
  tunnelId: string | null;
  runtimeKeySaved: boolean;
  configured: boolean;
  serviceInstalled: boolean;
  autoStart: boolean;
  serviceState: string;
  tunnelHealthy: boolean;
  connected: boolean;
  checkedAt: string;
}

export async function getTunnelStatus(): Promise<TunnelStatus> {
  const p = paths();
  const tunnelId = profileTunnelId();
  const runtimeKeySaved = privateFile(p.key);
  const state = await unitProperty('ActiveState');
  const enabled = await unitProperty('UnitFileState');
  const serviceActive = state === 'active';
  const { health, connected } = serviceActive
    ? await liveTunnelHealth(p.client)
    : { health: false, connected: false };
  return {
    available: config.host === '127.0.0.1' || config.host === 'localhost' || config.host === '::1',
    tunnelClientInstalled: existsSync(p.client),
    localMcpCredentialsSaved: privateFile(p.mcpEnv) && privateFile(p.patzerPassword),
    tunnelId,
    runtimeKeySaved,
    configured: !!tunnelId && runtimeKeySaved,
    serviceInstalled: existsSync(p.unit),
    autoStart: enabled === 'enabled',
    serviceState: state || 'not-installed',
    tunnelHealthy: health,
    connected,
    checkedAt: new Date().toISOString(),
  };
}

export interface SetupOptions { tunnelId: string; runtimeKey?: string; autoStart: boolean; username: string; patzerPassword?: string }
export async function saveTunnelSetup(options: SetupOptions) {
  const p = paths();
  if (!validateTunnelId(options.tunnelId)) throw Error('Invalid OpenAI tunnel ID.');
  if (options.runtimeKey && !validateRuntimeKey(options.runtimeKey)) throw Error('The runtime API key contains unsupported characters.');
  if (options.patzerPassword && !/^[A-Za-z0-9_-]{2,40}$/.test(options.username)) throw Error('Invalid local account username.');
  if (!options.runtimeKey && !privateFile(p.key)) throw Error('Enter the OpenAI Platform runtime API key.');
  if (!existsSync(p.client)) throw Error('Install the official OpenAI tunnel-client at ~/.local/bin/tunnel-client first.');
  if (!existsSync(p.stdio)) throw Error('The Patzer MCP stdio bridge is missing.');
  if (!privateFile(p.mcpEnv) && !options.patzerPassword) throw Error('Enter your Patzer password to connect the local MCP bridge.');

  // No shell interpolation: all commands and paths are application-controlled.
  mkdirSync(p.controlDir, { recursive: true, mode: 0o700 });
  chmodSync(p.controlDir, 0o700);
  await exec(p.client, [
    'init', '--sample', 'sample_mcp_stdio_local', '--profile', 'patzer', '--force',
    '--tunnel-id', options.tunnelId, '--health-listen-addr', '127.0.0.1:8895',
    '--mcp-command', `${process.execPath} ${p.stdio}`,
  ], { timeout: 15000, maxBuffer: 65536 });

  if (options.runtimeKey) atomicPrivateWrite(p.key, `CONTROL_PLANE_API_KEY=${options.runtimeKey}\n`);
  if (options.patzerPassword) {
    atomicPrivateWrite(p.patzerPassword, options.patzerPassword);
    atomicPrivateWrite(p.mcpEnv, [
      'PATZER_URL=http://127.0.0.1:8800',
      `PATZER_USERNAME=${options.username}`,
      `PATZER_PASSWORD_FILE=${p.patzerPassword}`, '',
    ].join('\n'));
  }

  const unit = `[Unit]\nDescription=Patzer OpenAI Secure MCP Tunnel\nAfter=network-online.target patzer.service\nWants=network-online.target patzer.service\n\n[Service]\nType=simple\nEnvironmentFile=${p.key}\nExecStart=${p.client} run --profile patzer\nRestart=on-failure\nRestartSec=5\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
  mkdirSync(dirname(p.unit), { recursive: true });
  writeFileSync(p.unit, unit, { mode: 0o644 });
  await systemctl('daemon-reload');
  if (options.autoStart) await systemctl('enable', SERVICE);
  else await systemctl('disable', SERVICE);
  await systemctl('restart', SERVICE);
  return getTunnelStatus();
}

export async function startTunnel() {
  if (!privateFile(paths().key) || !profileTunnelId()) throw Error('Complete the connection wizard first.');
  await systemctl('start', SERVICE);
  return getTunnelStatus();
}
export async function stopTunnel() {
  await systemctl('stop', SERVICE);
  return getTunnelStatus();
}

/** A real MCP tool call: verifies bridge credentials without returning any chess data. */
export async function testLocalMcp(): Promise<{ ok: boolean; message: string }> {
  const p = paths();
  if (!privateFile(p.mcpEnv)) return { ok: false, message: 'Patzer MCP credentials have not been configured.' };
  return new Promise((resolveTest) => {
    const child = spawn(process.execPath, [p.stdio], { cwd: config.projectRoot, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => done(false, 'The Patzer MCP check timed out.'), 14000);
    function done(ok: boolean, message: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolveTest({ ok, message });
    }
    child.on('error', () => done(false, 'Could not start the local Patzer MCP server.'));
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 100000) return done(false, 'Unexpectedly large MCP response.');
      const line = output.split('\n')[0];
      if (!output.includes('\n')) return;
      try {
        const reply = JSON.parse(line) as { result?: { isError?: boolean; content?: { text: string }[] } };
        const parsed = reply.result?.content?.[0]?.text ? JSON.parse(reply.result.content[0].text) as { games?: unknown[] } : null;
        done(!reply.result?.isError && Array.isArray(parsed?.games), !reply.result?.isError && Array.isArray(parsed?.games)
          ? 'Patzer MCP authenticated successfully. Game listing works.'
          : 'MCP login failed. Update your Patzer credentials.');
      } catch { done(false, 'Patzer MCP returned an invalid response.'); }
    });
    child.on('exit', () => done(false, 'Patzer MCP stopped before responding.'));
    child.stdin.on('error', () => done(false, 'Unable to contact the local MCP bridge.'));
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_games', arguments: { limit: 1 } } }) + '\n');
  });
}
