#!/usr/bin/env node
// Builds the puzzle set of Train → Puzzles (server/src/chess/tacticsSet.json)
// from the Lichess puzzle database (https://database.lichess.org/#puzzles, CC0).
//
//   curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
//   zstd -dc lichess_db_puzzle.csv.zst | npm run -s build:tactics -- --snapshot "downloaded 2026-09-25"
//
// The whole database is the pool. From it, per 100-point rating band from 400
// to 2599, the most popular puzzles (Lichess "Popularity", then number of plays,
// then id) that were played often enough:
//   - rating 1000 and up: popularity >= 90 and at least 3000 plays;
//   - below 1000:         popularity >= 88 and at least 1000 plays (the
//                         database has far fewer easy puzzles);
// 185 per band, and no motif (the first of MOTIFS in the puzzle's themes) more
// than a quarter of a band, so a band isn't all mate-in-one.
// Puzzles that a Learn lesson already uses (the `src` ids in
// web/src/learn/content/*.json) are left out, so you don't meet them twice.
// Only the theme tags the page's filters use are kept.
//
// Lichess updates the database every month (new puzzles, ratings and
// popularity move), so the same snapshot and the same lessons give the same
// set; a newer snapshot gives a similar set, not the same one.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'server/src/chess/tacticsSet.json');
const LESSONS = join(ROOT, 'web/src/learn/content');

const LO = 400, HI = 2600, BAND = 100, PER_BAND = 185;
const MIN_POPULARITY = 90, MIN_PLAYS = 3000;
const LOW_RATING = 1000, LOW_POPULARITY = 88, LOW_PLAYS = 1000;
const MOTIFS = ['mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'fork', 'pin', 'skewer', 'discoveredAttack', 'hangingPiece',
  'sacrifice', 'deflection', 'attraction', 'defensiveMove', 'endgame'];
const KEEP = new Set(['mate', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'fork', 'pin', 'skewer',
  'discoveredAttack', 'doubleCheck', 'sacrifice', 'hangingPiece', 'trappedPiece', 'defensiveMove', 'endgame']);

const args = process.argv.slice(2);
const snapshot = args.includes('--snapshot') ? args[args.indexOf('--snapshot') + 1] : 'snapshot date unknown';

const inLessons = new Set();
for (const file of readdirSync(LESSONS).filter((f) => f.endsWith('.json'))) {
  JSON.stringify(JSON.parse(readFileSync(join(LESSONS, file), 'utf8')), (key, value) => {
    if (key === 'src' && typeof value === 'string') inLessons.add(value);
    return value;
  });
}

const bands = new Map();
let total = 0, header = null;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!header) { header = line.split(','); continue; }
  if (!line) continue;
  total++;
  // No field of the CSV contains a comma (themes and opening tags are space-separated).
  const f = Object.fromEntries(line.split(',').map((v, i) => [header[i], v]));
  const rating = Number(f.Rating), popularity = Number(f.Popularity), plays = Number(f.NbPlays);
  if (!(rating >= LO && rating < HI) || inLessons.has(f.PuzzleId)) continue;
  const low = rating < LOW_RATING;
  if (popularity < (low ? LOW_POPULARITY : MIN_POPULARITY) || plays < (low ? LOW_PLAYS : MIN_PLAYS)) continue;
  const themes = f.Themes.split(' ');
  const band = Math.floor((rating - LO) / BAND);
  if (!bands.has(band)) bands.set(band, []);
  bands.get(band).push({ id: f.PuzzleId, fen: f.FEN, moves: f.Moves, rating, popularity, plays, themes,
    motif: MOTIFS.find((m) => themes.includes(m)) ?? 'other' });
}
if (!header || header[0] !== 'PuzzleId' || total === 0) {
  console.error('No puzzles read. Pipe the decompressed lichess_db_puzzle.csv into this script.');
  process.exit(1);
}

const picked = [];
for (const band of [...bands.keys()].sort((a, b) => a - b)) {
  const pool = bands.get(band).sort((a, b) => b.popularity - a.popularity || b.plays - a.plays || (a.id < b.id ? -1 : 1));
  const perMotif = new Map();
  let n = 0;
  for (const p of pool) {
    if (n >= PER_BAND) break;
    if ((perMotif.get(p.motif) ?? 0) >= Math.floor(PER_BAND / 4)) continue;
    perMotif.set(p.motif, (perMotif.get(p.motif) ?? 0) + 1);
    picked.push(p);
    n++;
  }
  console.error(`${LO + band * BAND}-${LO + (band + 1) * BAND - 1}: ${n} of ${pool.length}`);
}
picked.sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1));

const info = {
  source: 'Lichess puzzle database, https://database.lichess.org/#puzzles',
  license: 'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)',
  snapshot: `lichess_db_puzzle.csv, ${total} puzzles, ${snapshot}`,
  generator: 'scripts/build-tactics-set.mjs (see the comment there for how the puzzles are chosen)',
  format: "id|FEN|moves (UCI, the opponent's move first)|rating|themes",
};
const lines = picked.map((p) => [p.id, p.fen, p.moves, p.rating, p.themes.filter((t) => KEEP.has(t)).join(' ')].join('|'));
// One puzzle per line, so a regenerated set gives a readable diff.
writeFileSync(OUT, '{\n'
  + Object.entries(info).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join('')
  + '  "puzzles": [\n' + lines.map((l) => `    ${JSON.stringify(l)}`).join(',\n') + '\n  ]\n}\n');
console.error(`${picked.length} puzzles → ${OUT} (${inLessons.size} Learn puzzles left out)`);
