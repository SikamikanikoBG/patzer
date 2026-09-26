#!/usr/bin/env node
// Checks the Learn section's tasks with Stockfish — the part the unit tests
// (web/src/learn/content.test.ts) can't judge: whether the move a lesson calls
// right really is the best move, and clearly so.
//
//   npm run verify:lessons            (needs Stockfish: `npm run setup`, or STOCKFISH_PATH)
//   DEPTH=24 npm run verify:lessons   (deeper, slower)
//
// For every "find the move" task, at each of your moves:
//   - a mating move is always fine (the page accepts every mate);
//   - one right answer: it must be Stockfish's first choice and at least
//     MIN_GAP centipawns better than the second, so no other move is just as good;
//   - several right answers (`accept`): Stockfish's first choice must be one of
//     them (or no better than the best of them), and none may be a real mistake.
// "rule" tasks name the move ("castle long"): it only has to be sound, i.e.
// lose no more than MAX_ACCEPT_LOSS against Stockfish's choice. "check" and
// "exact" tasks are about the rules, not about the best move, and are left to
// the unit tests. For "play it out" tasks the start position must
// be a forced win within the move limit.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'web/src/learn/content');
const DEPTH = Number(process.env.DEPTH ?? 20);
const PLAY_DEPTH = Number(process.env.PLAY_DEPTH ?? 28);
const MIN_GAP = 150;
const MAX_ACCEPT_LOSS = 80;

function stockfishPath() {
  const candidates = [
    process.env.STOCKFISH_PATH,
    join(ROOT, 'bin', process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'),
    '/usr/games/stockfish', '/usr/bin/stockfish', '/usr/local/bin/stockfish', '/opt/homebrew/bin/stockfish',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error('Stockfish not found. Run `npm run setup` or set STOCKFISH_PATH.');
    process.exit(2);
  }
  return found;
}

class Engine {
  constructor(path) {
    this.p = spawn(path);
    this.buf = '';
    this.listeners = new Set();
    this.p.stdout.on('data', (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        for (const l of [...this.listeners]) l(line);
      }
    });
  }
  send(s) { this.p.stdin.write(s + '\n'); }
  until(pred, onLine) {
    return new Promise((done) => {
      const l = (line) => {
        onLine?.(line);
        if (pred(line)) { this.listeners.delete(l); done(line); }
      };
      this.listeners.add(l);
    });
  }
  async init() {
    this.send('uci');
    await this.until((l) => l === 'uciok');
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 128');
    this.send('isready');
    await this.until((l) => l === 'readyok');
  }
  /** Top `multipv` lines at `depth`, best first, scores from the mover's view. */
  async analyse(fen, depth, multipv) {
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send('ucinewgame');
    this.send(`position fen ${fen}`);
    const lines = new Map();
    const collect = (line) => {
      if (!line.startsWith('info ') || !line.includes(' pv ')) return;
      const k = Number(/ multipv (\d+)/.exec(line)?.[1] ?? 1);
      const cp = / score cp (-?\d+)/.exec(line);
      const mate = / score mate (-?\d+)/.exec(line);
      lines.set(k, { move: line.split(' pv ')[1].split(' ')[0], cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null });
    };
    this.send(`go depth ${depth}`);
    await this.until((l) => l.startsWith('bestmove'), collect);
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }
  quit() { this.send('quit'); }
}

/** Comparable score: mates beat everything, sooner mates beat later ones. */
function value(l) {
  if (!l) return -1e6;
  if (l.mate !== null) return l.mate > 0 ? 1e5 - l.mate : -1e5 - l.mate;
  return l.cp;
}
const show = (l) => (l.mate !== null ? `#${l.mate}` : `${l.cp}cp`);

function tasks() {
  const out = [];
  for (const file of readdirSync(CONTENT).filter((f) => f.endsWith('.json')).sort()) {
    const level = JSON.parse(readFileSync(join(CONTENT, file), 'utf8'));
    for (const course of level.courses) {
      for (const lesson of course.lessons) {
        for (const step of lesson.steps) {
          if (step.type === 'move' || step.type === 'play') out.push({ name: `${lesson.id}.${step.id}`, step });
        }
      }
    }
  }
  return out;
}

async function checkMove(engine, name, step) {
  const problems = [];
  if (step.goal === 'check' || step.exact) return problems;
  const chess = new Chess(step.fen);
  if (step.pre) chess.move(step.pre);
  for (let i = 0; i < step.line.length; i++) {
    const uci = step.line[i];
    const fen = chess.fen();
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (i % 2 === 1 || chess.isCheckmate()) continue;
    const right = i === 0 && step.accept ? [uci, ...step.accept] : [uci];
    if (step.rule) {
      const [best] = await engine.analyse(fen, DEPTH, 1);
      if (best.move === uci) continue;
      const after = new Chess(fen);
      after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      const [reply] = await engine.analyse(after.fen(), DEPTH - 2, 1);
      const mine = reply ? { cp: reply.cp === null ? null : -reply.cp, mate: reply.mate === null ? null : -reply.mate } : { cp: 0, mate: null };
      const loss = value(best) - value(mine);
      // A mate that is merely slower than the fastest one is still a win.
      const bothWin = best.mate > 0 && (mine.mate > 0 || mine.cp >= 500);
      if (loss > MAX_ACCEPT_LOSS && !bothWin) problems.push(`${name} move ${i + 1}: ${uci} loses ${loss}cp against ${best.move} (${show(best)})`);
      continue;
    }
    const probe = new Chess(fen);
    const legal = probe.moves({ verbose: true }).length;
    const lines = await engine.analyse(fen, DEPTH, Math.min(legal, Math.max(2, right.length + 1)));
    const best = lines[0];
    if (right.length === 1) {
      if (best.move !== uci) {
        problems.push(`${name} move ${i + 1}: Stockfish plays ${best.move} (${show(best)}), not ${uci}`);
        continue;
      }
      const second = lines[1];
      if (!second) continue;
      const bothMate = best.mate > 0 && second.mate > 0;
      if (bothMate && second.mate <= best.mate + 1) problems.push(`${name} move ${i + 1}: ${second.move} mates too (#${second.mate})`);
      else if (!bothMate && value(best) - value(second) < MIN_GAP) {
        problems.push(`${name} move ${i + 1}: ${second.move} (${show(second)}) is nearly as good as ${uci} (${show(best)})`);
      }
    } else {
      const scored = new Map(lines.map((l) => [l.move, l]));
      // Accepted moves the search didn't list are scored on their own.
      for (const m of right) {
        if (scored.has(m)) continue;
        const after = new Chess(fen);
        after.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
        const [reply] = await engine.analyse(after.fen(), DEPTH - 2, 1);
        const flip = reply ? { move: m, cp: reply.cp === null ? null : -reply.cp, mate: reply.mate === null ? null : -reply.mate } : { move: m, cp: 0, mate: null };
        if (after.isCheckmate()) { flip.mate = 1; flip.cp = null; }
        scored.set(m, flip);
      }
      const bestRight = Math.max(...right.map((m) => value(scored.get(m))));
      if (!right.includes(best.move) && value(best) - bestRight > MIN_GAP / 3) {
        problems.push(`${name}: Stockfish's ${best.move} (${show(best)}) is better than every accepted move`);
      }
      for (const m of right) {
        const loss = value(best) - value(scored.get(m));
        if (loss > MAX_ACCEPT_LOSS) problems.push(`${name}: accepted ${m} loses ${loss}cp against ${best.move}`);
      }
    }
  }
  return problems;
}

async function checkPlay(engine, name, step) {
  const [best] = await engine.analyse(step.fen, PLAY_DEPTH, 1);
  if (step.goal === 'mate') {
    if (!(best.mate > 0)) return [`${name}: no forced mate found (${show(best)})`];
    if (best.mate > step.limit) return [`${name}: mate needs ${best.mate} moves, limit is ${step.limit}`];
    return [];
  }
  if (!(best.mate > 0) && !(best.cp >= 500)) return [`${name}: not clearly winning (${show(best)})`];
  return [];
}

async function main() {
  const path = stockfishPath();
  const jobs = tasks();
  const n = Math.max(1, Math.min(Number(process.env.ENGINES ?? cpus().length - 1), 8, jobs.length));
  const engines = await Promise.all(Array.from({ length: n }, async () => { const e = new Engine(path); await e.init(); return e; }));
  const problems = [];
  let done = 0;
  await Promise.all(engines.map(async (engine) => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const found = job.step.type === 'move'
        ? await checkMove(engine, job.name, job.step)
        : await checkPlay(engine, job.name, job.step);
      problems.push(...found);
      done += 1;
      if (done % 50 === 0) console.error(`${done} checked …`);
    }
  }));
  engines.forEach((e) => e.quit());
  if (problems.length) {
    console.log(problems.sort().join('\n'));
    console.log(`\n${problems.length} problem(s) in ${done} tasks.`);
    process.exit(1);
  }
  console.log(`All ${done} tasks check out (depth ${DEPTH}).`);
}

main();
