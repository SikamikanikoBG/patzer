// Extra analysis engines an admin can install from Admin → System.
//
// Downloading a program and running it is the most dangerous thing this server
// does, so the rules are strict:
//   - Only the engines listed in ENGINE_CATALOG below — never a URL, path or
//     id that came in over HTTP.
//   - Each build is pinned to the SHA-256 its release published. A download
//     that doesn't match byte for byte is deleted, not installed.
//   - The binary is only ever spawned directly (no shell), and has to complete
//     a UCI handshake before it counts as installed.
// Linux only: that is what the Docker image runs, and what these projects
// publish ready-made binaries for.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync, closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync,
  readSync, readdirSync, renameSync, rmSync, statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

type Arch = 'x64' | 'arm64';

interface EngineBuild {
  url: string;
  sha256: string;
  size: number;
  /** A .tar.gz holding the binary; otherwise the download is the binary. */
  archive?: 'tar.gz';
  /** CPU flags (as in /proc/cpuinfo) the build needs. */
  cpu?: string[];
}

interface CatalogEngine {
  id: string;
  name: string;
  version: string;
  homepage: string;
  /** Ignores MultiPV: one line per position, so no second-best move to compare against. */
  singleLine?: boolean;
  builds: Partial<Record<Arch, EngineBuild>>;
}

// Official release assets, with the digests GitHub reports for them. Each x64
// build was installed and run in the Docker image before it was listed; engines
// whose binaries don't start there (newer glibc) are left out.
export const ENGINE_CATALOG: readonly CatalogEngine[] = [
  {
    id: 'stockfish-19',
    name: 'Stockfish',
    version: '19',
    homepage: 'https://stockfishchess.org',
    builds: {
      x64: {
        url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz',
        sha256: '9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f',
        size: 81388977,
        archive: 'tar.gz',
      },
      arm64: {
        url: 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-arm64-universal.tar.gz',
        sha256: 'fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01',
        size: 80181250,
        archive: 'tar.gz',
      },
    },
  },
  {
    id: 'viridithas-20',
    name: 'Viridithas',
    version: '20',
    homepage: 'https://github.com/cosmobobak/viridithas',
    singleLine: true,
    builds: {
      x64: {
        url: 'https://github.com/cosmobobak/viridithas/releases/download/v20.0.0/viridithas-20-linux-x86-64-v3',
        sha256: 'eb53de2fde546f3ba294407e3e8986dc3859bb1818f2ef4cf2fd85d077779973',
        size: 57800608,
        cpu: ['avx2', 'bmi2'],
      },
      arm64: {
        url: 'https://github.com/cosmobobak/viridithas/releases/download/v20.0.0/viridithas-20-linux-aarch64-generic',
        sha256: 'd8870b63517c7033754728b53130a0749cbc96d46d83fbbb2b4a448191044ea9',
        size: 56430832,
      },
    },
  },
  {
    id: 'reckless-0.9',
    name: 'Reckless',
    version: '0.9.0',
    homepage: 'https://github.com/codedeliveryservice/Reckless',
    builds: {
      x64: {
        url: 'https://github.com/codedeliveryservice/Reckless/releases/download/v0.9.0/reckless-linux-avx2',
        sha256: '09ba1634faaffec55d237a7efecfb27d5152f6f1400f24dd63af9bde00a054f6',
        size: 65004440,
        cpu: ['avx2'],
      },
    },
  },
  {
    id: 'avalanche-4',
    name: 'Avalanche',
    version: '4.0.0',
    homepage: 'https://github.com/SnowballSH/Avalanche',
    singleLine: true,
    builds: {
      x64: {
        url: 'https://github.com/SnowballSH/Avalanche/releases/download/v4.0.0/Avalanche-4.0.0-x86_64-linux-v3',
        sha256: '00881e65d948021cd80657345535a370ea86d969f4f39a8cf37878796626b673',
        size: 32556952,
        cpu: ['avx2', 'bmi2'],
      },
      arm64: {
        url: 'https://github.com/SnowballSH/Avalanche/releases/download/v4.0.0/Avalanche-4.0.0-aarch64-linux-general',
        sha256: '72090fdbabeb69ead78f8190cf8a1667b1fb8e90302912cb5b58f6a8a1fc1ce8',
        size: 33213368,
      },
    },
  },
];

export type EngineJobState = 'downloading' | 'verifying' | 'failed';
interface Job { state: EngineJobState; received: number; total: number; error?: string }

export interface EngineStatus {
  id: string;
  name: string;
  version: string;
  homepage: string;
  singleLine: boolean;
  size: number | null;
  installed: boolean;
  /** Why it can't be installed here, or null when it can. */
  unavailable: 'platform' | 'arch' | 'cpu' | null;
  job: Job | null;
}

const jobs = new Map<string, Job>();

function enginesDir(): string {
  return join(dirname(config.dbPath), 'engines');
}

function binaryPath(id: string): string {
  return join(enginesDir(), id, 'engine');
}

let cpuFlags: Set<string> | null = null;
function hostCpuFlags(): Set<string> {
  if (cpuFlags) return cpuFlags;
  cpuFlags = new Set();
  try {
    const line = readFileSync('/proc/cpuinfo', 'utf8').split('\n').find((l) => /^(flags|Features)\s*:/.test(l));
    for (const f of (line?.split(':')[1] ?? '').trim().split(/\s+/)) if (f) cpuFlags.add(f);
  } catch { /* not Linux, or /proc hidden — no flags known */ }
  return cpuFlags;
}

function buildFor(e: CatalogEngine): { build: EngineBuild | null; unavailable: EngineStatus['unavailable'] } {
  if (process.platform !== 'linux') return { build: null, unavailable: 'platform' };
  const build = e.builds[process.arch as Arch];
  if (!build) return { build: null, unavailable: 'arch' };
  const flags = hostCpuFlags();
  if (build.cpu?.some((f) => !flags.has(f))) return { build, unavailable: 'cpu' };
  return { build, unavailable: null };
}

/** Path of an installed catalog engine, or null. Unknown ids are never a path. */
export function installedEnginePath(id: string | null | undefined): string | null {
  if (!id || !ENGINE_CATALOG.some((e) => e.id === id)) return null;
  const p = binaryPath(id);
  return existsSync(p) ? p : null;
}

export function engineStatus(): EngineStatus[] {
  return ENGINE_CATALOG.map((e) => {
    const { build, unavailable } = buildFor(e);
    return {
      id: e.id, name: e.name, version: e.version, homepage: e.homepage,
      singleLine: !!e.singleLine,
      size: build?.size ?? null,
      installed: !!installedEnginePath(e.id),
      unavailable,
      job: jobs.get(e.id) ?? null,
    };
  });
}

function isBusy(id: string): boolean {
  const j = jobs.get(id);
  return !!j && j.state !== 'failed';
}

/** Starts the download in the background; progress shows up in engineStatus(). */
export function startInstall(id: string): { ok: true } | { ok: false; error: string } {
  const e = ENGINE_CATALOG.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'unknown_engine' };
  const { build, unavailable } = buildFor(e);
  if (!build || unavailable) return { ok: false, error: `unavailable_${unavailable}` };
  if (isBusy(id)) return { ok: false, error: 'already_installing' };
  if (installedEnginePath(id)) return { ok: true };

  const job: Job = { state: 'downloading', received: 0, total: build.size };
  jobs.set(id, job);
  void install(id, build, job).then(
    () => { jobs.delete(id); },
    (err) => {
      job.state = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      console.warn(`[engines] install ${id} failed:`, job.error);
    },
  );
  return { ok: true };
}

export function removeEngine(id: string): { ok: true } | { ok: false; error: string } {
  if (!ENGINE_CATALOG.some((e) => e.id === id)) return { ok: false, error: 'unknown_engine' };
  if (isBusy(id)) return { ok: false, error: 'already_installing' };
  jobs.delete(id);
  rmSync(join(enginesDir(), id), { recursive: true, force: true });
  return { ok: true };
}

async function install(id: string, build: EngineBuild, job: Job): Promise<void> {
  const dir = join(enginesDir(), id);
  const tmp = join(enginesDir(), `.${id}.tmp`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    const file = join(tmp, 'download');
    await download(build, file, job);

    job.state = 'verifying';
    let binary = file;
    if (build.archive === 'tar.gz') {
      const out = join(tmp, 'unpacked');
      mkdirSync(out);
      await run('tar', ['-xzf', file, '-C', out]);
      const found = largestElf(out);
      if (!found) throw new Error('no_binary_in_archive');
      binary = found;
    }
    chmodSync(binary, 0o755);
    await uciHandshake(binary);

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    renameSync(binary, binaryPath(id));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function download(build: EngineBuild, dest: string, job: Job): Promise<void> {
  const res = await fetch(build.url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`download_http_${res.status}`);
  const hash = createHash('sha256');
  const out = createWriteStream(dest);
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      job.received += chunk.length;
      // The size is known in advance; anything longer is not the pinned file.
      if (job.received > build.size) throw new Error('download_too_large');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()));
  }
  if (job.received !== build.size || hash.digest('hex') !== build.sha256) throw new Error('checksum_mismatch');
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd}_exit_${code}`))));
  });
}

/** The archive ships docs and sources next to the engine; the engine is the big ELF. */
function largestElf(root: string): string | null {
  let best: { path: string; size: number } | null = null;
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) {
        const size = statSync(p).size;
        if ((!best || size > best.size) && isElf(p)) best = { path: p, size };
      }
    }
  };
  walk(root);
  return (best as { path: string; size: number } | null)?.path ?? null;
}

function isElf(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && head[0] === 0x7f && head.toString('latin1', 1, 4) === 'ELF';
  } finally {
    closeSync(fd);
  }
}

/** Runs the binary just long enough to hear `uciok` — proof it starts on this machine. */
function uciHandshake(path: string): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(path, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { p.kill('SIGKILL'); } catch { /* already gone */ }
      if (err) rej(err); else res();
    };
    const timer = setTimeout(() => finish(new Error('engine_did_not_start')), 20_000);
    p.on('error', () => finish(new Error('engine_did_not_start')));
    p.on('exit', () => finish(new Error('engine_did_not_start')));
    p.stdin.on('error', () => { /* the exit handler reports it */ });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk: string) => {
      out += chunk;
      if (/^uciok\s*$/m.test(out)) finish();
    });
    p.stdin.write('uci\n');
  });
}
