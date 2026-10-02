import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';

// The coach as a coach: why a move is good or bad, the better idea, the
// player's history, next steps — and never contradicting the engine.
//
// Regression for discussion #37: Game Review called 3...Nf6?? (allowing
// 4.Qxf7#) a blunder while the coach, even on a 27B model, opened with
// "Great development bringing that knight out". The prompt anchored the
// model on "material is equal", its only example praised development, and
// nothing said *why* the move lost. These tests pin the facts the model now
// gets and the guard that stops a praising answer from ever reaching the
// player.

const dir = mkdtempSync(join(tmpdir(), 'patzer-coach-'));
process.env.DB_PATH = join(dir, 'coach.db');

const at = (moves: string[]) => { const c = new Chess(); for (const m of moves) c.move(m); return c.fen(); };
const HISTORY = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4'];
const SCHOLAR = at(HISTORY);
const AFTER_NF6 = at([...HISTORY, 'Nf6']);
const PRAISE_37 = 'Great development bringing that knight out. But the queen on h5 is now hunting your king. That blunder leaves you in a losing position.';
const GOOD_ANSWER = 'That was a blunder: it lets the queen take on f7 with checkmate. The pawn to g6 stops that and hits the queen. Before every move, check the checks your opponent has.';

type Coaching = typeof import('../src/coach/coaching.js');
type Memory = typeof import('../src/coach/memory.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let coaching: Coaching;
let memory: Memory;
let coach: Router;
let cookie: string;

// ── A scripted engine: the lines Stockfish gives for the positions used here.
const ENGINE: Record<string, { cp: number | null; mate: number | null; pv: string[] }[]> = {
  [SCHOLAR]: [
    { cp: 20, mate: null, pv: ['g7g6', 'h5f3'] },
    { cp: 35, mate: null, pv: ['d8e7'] },
    { cp: 45, mate: null, pv: ['d8f6'] },
  ],
  [AFTER_NF6]: [{ cp: null, mate: 1, pv: ['h5f7'] }],
};
let engineCalls: string[] = [];

// ── A fake OpenAI-compatible LLM (vLLM routes) with scripted answers.
let llm: Server;
let replies: string[] = [];
let prompts: { system: string; user: string }[] = [];

function sse(text: string): string {
  return text.split(/(?<= )/).map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
}

beforeAll(async () => {
  llm = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'coach-model' }] }));
      }
      const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
      prompts.push({ system: body.messages[0]!.content, user: body.messages[1]!.content });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sse(replies.shift() ?? GOOD_ANSWER));
    });
  });
  await new Promise<void>((r) => llm.listen(0, '127.0.0.1', () => r()));

  const dbm = await import('../src/db.js');
  const url = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
  dbm.setSetting('llm_provider', 'vllm');
  dbm.setSetting('vllm_url', url);
  dbm.setSetting('vllm_model', 'coach-model');

  coaching = await import('../src/coach/coaching.js');
  memory = await import('../src/coach/memory.js');
  coaching.setCoachEngine(async (fen) => {
    engineCalls.push(fen);
    return ENGINE[fen] ?? null;
  });
  coach = (await import('../src/routes/coach.js')).default;

  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  dbm.db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'kasparov', 'x', 'user'), (2, 'newbie', 'x', 'user')`).run();
  dbm.db.prepare(`INSERT INTO profiles (user_id, display_name, language, audience) VALUES (1, 'K', 'en', 'beginner'), (2, 'N', 'en', 'beginner')`).run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  // Player 1 has played Black into the same trap in four games, and plays
  // the endgame far worse than the opening.
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  const blunder = {
    ply: 6, san: 'Nf6', uci: 'g8f6', fen_before: SCHOLAR, fen_after: AFTER_NF6,
    eval_before_cp: 20, eval_after_cp: 10000, mate_before: null, mate_after: 1,
    best_move_uci: 'g7g6', best_move_san: 'g6', best_pv: ['g6'], centipawn_loss: 9000, classification: 'blunder',
  };
  const split = {
    opening: { from_ply: 1, to_ply: 20, accuracy_white: 90, accuracy_black: 85, acpl_white: 10, acpl_black: 20 },
    middlegame: { from_ply: 21, to_ply: 60, accuracy_white: 80, accuracy_black: 75, acpl_white: 30, acpl_black: 40 },
    endgame: { from_ply: 61, to_ply: 90, accuracy_white: 80, accuracy_black: 55, acpl_white: 30, acpl_black: 90 },
  };
  for (let i = 1; i <= 4; i++) {
    dbm.db.prepare(`INSERT INTO games (id, user_id, source, pgn, user_color, end_time) VALUES (?, 1, 'played', '', 'black', ?)`)
      .run(i, `2026-09-2${i}T10:00:00Z`);
    dbm.db.prepare(`INSERT INTO analyses (game_id, depth, moves_json, phase_split_json, scoring_version) VALUES (?, 16, ?, ?, ?)`)
      .run(i, JSON.stringify([blunder]), JSON.stringify(split), SCORING_VERSION);
  }
  dbm.db.prepare(`INSERT INTO opening_misses (user_id, line_name, user_color, moves, position, expected_san, expected_uci, misses)
    VALUES (1, 'Scholar', 'black', 'e4 e5 Qh5 Nc6 Bc4', ?, 'g6', 'g7g6', 2)`).run(SCHOLAR.split(' ').slice(0, 4).join(' '));
});

afterAll(async () => {
  await new Promise((r) => llm.close(r));
  try { (await import('../src/db.js')).db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  replies = [];
  prompts = [];
  engineCalls = [];
  memory.forgetPlayerMemory();
});

const blunderInput = { fen: SCHOLAR, played_san: 'Nf6', best_san: 'g6', classification: 'blunder' as const, userId: 1, ownMove: true };

describe('explainCoaching — the facts behind a blunder', () => {
  it('says why: the move allows Qxf7#, which is the opponent\'s best answer', async () => {
    const c = await coaching.explainCoaching(blunderInput, 'en', 'beginner');
    expect(c.facts.tone).toBe('correct');
    expect((c.facts.why as string[]).join(' ')).toMatch(/checkmate at once: the queen takes the pawn on f7/);
    expect(c.facts.opponent_reply).toMatch(/queen takes the pawn on f7/);
  });

  it('shows the better move and the alternatives, each with what it achieves', async () => {
    const c = await coaching.explainCoaching(blunderInput, 'en', 'beginner');
    expect(c.facts.better_move).toBe('the pawn to g6: it stops the checkmate threat; it attacks a loose piece (queen on h5)');
    expect(c.facts.other_good_moves).toEqual([
      'the queen from d8 to e7: it stops the checkmate threat',
      'the queen from d8 to f6: it stops the checkmate threat',
    ]);
    expect(c.facts.takeaway).toMatch(/every check the opponent could give/);
  });

  it('connects the move to the player\'s history and the opening trainer', async () => {
    const c = await coaching.explainCoaching(blunderInput, 'en', 'beginner');
    const history = (c.facts.player_history as string[]).join(' ');
    expect(history).toContain('(4 of your last 4): allowing a quick checkmate');
    expect(history).toContain('opening trainer (missed 2×); the right move there is the pawn to g6');
    expect(c.mistakeKind).toBe('allowed_mate');
  });

  it('suggests the matching lesson and puzzles', async () => {
    const c = await coaching.explainCoaching(blunderInput, 'en', 'beginner');
    expect(c.actions).toEqual([{ kind: 'learn', lesson: 'mate-in-one' }, { kind: 'train' }]);
  });

  it('fills in the evaluation Play never sends', async () => {
    const c = await coaching.explainCoaching(blunderInput, 'en', 'beginner');
    expect(c.eval_before_cp).toBe(20);
    expect(c.eval_after_cp).toBe(10000);
  });

  it('keeps the opponent\'s moves and other players out of "your history"', async () => {
    const theirs = await coaching.explainCoaching({ ...blunderInput, ownMove: false }, 'en', 'beginner');
    expect(theirs.facts.player_history).toEqual([]);
    const newbie = await coaching.explainCoaching({ ...blunderInput, userId: 2 }, 'en', 'beginner');
    expect(newbie.facts.player_history).toEqual([]);
  });

  it('still coaches from chess.js alone when there is no engine', async () => {
    const prev = coaching.setCoachEngine(async () => null);
    try {
      const c = await coaching.explainCoaching(blunderInput, 'en', 'beginner');
      expect((c.facts.why as string[])[0]).toMatch(/checkmate at once/);
      expect(c.facts.better_move).toMatch(/^the pawn to g6/);
      expect(c.facts.opponent_reply).toBeNull();
      expect(c.facts.other_good_moves).toEqual([]);
    } finally {
      coaching.setCoachEngine(prev);
    }
  });

  it('praises a good move for what it does, with no takeaway or next steps', async () => {
    const c = await coaching.explainCoaching({ ...blunderInput, played_san: 'g6', classification: 'best' }, 'en', 'beginner');
    expect(c.facts.tone).toBe('praise');
    expect((c.facts.why as string[])[0]).toBe('the pawn to g6: it stops the checkmate threat; it attacks a loose piece (queen on h5).');
    expect(c.facts.better_move).toBeNull();
    expect(c.facts.takeaway).toBeNull();
    expect(c.actions).toEqual([]);
  });

  it('speaks the player\'s language', async () => {
    const expected = { bg: /дава мат веднага/, es: /dar mate de inmediato/, de: /sofort mattsetzen/, ru: /сразу ставит мат/ } as const;
    for (const [lang, re] of Object.entries(expected)) {
      const c = await coaching.explainCoaching(blunderInput, lang as 'bg', 'beginner');
      expect((c.facts.why as string[])[0], lang).toMatch(re);
    }
  });
});

describe('contradiction — the guard', () => {
  it('catches the exact answer from #37', () => {
    expect(coaching.contradiction(PRAISE_37, 'blunder', 'en')).toBe('praise_for_mistake');
  });

  it('lets an honest answer through, even one that calls the better move strong', () => {
    expect(coaching.contradiction(GOOD_ANSWER, 'blunder', 'en')).toBeNull();
    expect(coaching.contradiction('That was a mistake. The knight move was the strong, solid choice.', 'mistake', 'en')).toBeNull();
  });

  it('catches praise for a mistake in every language', () => {
    const praise = {
      en: 'Nice move, the knight comes out.', bg: 'Страхотно развитие на коня.', es: 'Excelente desarrollo del caballo.',
      de: 'Großartig, der Springer kommt raus.', ru: 'Отличное развитие коня.',
    } as const;
    for (const [lang, text] of Object.entries(praise)) {
      expect(coaching.contradiction(text, 'blunder', lang as 'en'), lang).toBe('praise_for_mistake');
    }
  });

  it('catches a good move called a blunder in every language', () => {
    const blame = {
      en: 'That is a blunder.', bg: 'Това е грешка.', es: 'Es un error.', de: 'Das ist ein Fehler.', ru: 'Это ошибка.',
    } as const;
    for (const [lang, text] of Object.entries(blame)) {
      expect(coaching.contradiction(text, 'best', lang as 'en'), lang).toBe('blame_for_good_move');
    }
  });

  it('never flags the verdict itself, in any language, for any class', async () => {
    // The Bulgarian mistake verdict says "имаше осезаемо по-добър ход" (there
    // was a better move) — "добър ход" is "good move", so every Bulgarian
    // answer quoting the verdict used to be rejected as praise.
    const { verdictPhrase } = await import('../src/coach/locales.js');
    const classes = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder', 'miss'] as const;
    for (const lang of ['en', 'bg', 'es', 'de', 'ru', 'fa'] as const) {
      for (const cls of classes) {
        const v = verdictPhrase(cls, lang);
        expect(coaching.contradiction(`${v.charAt(0).toUpperCase()}${v.slice(1)}.`, cls, lang), `${lang} ${cls}`).toBeNull();
      }
    }
  });

  it('has a facts-only answer that states the verdict first', async () => {
    const c = await coaching.explainCoaching(blunderInput, 'en', 'beginner');
    const t = coaching.fallbackText(c.facts, 'en');
    expect(t.startsWith('A blunder')).toBe(true);
    expect(t).toContain('checkmate at once');
    expect(t).toContain('Better: the pawn to g6');
    expect(coaching.contradiction(t, 'blunder', 'en')).toBeNull();
  });
});

describe('memory', () => {
  it('counts games per mistake kind and finds the weak phase', () => {
    const m = memory.playerMemory(1);
    expect(m.gamesReviewed).toBe(4);
    expect(m.mistakeGames.allowed_mate).toBe(4);
    expect(m.phaseAccuracy).toEqual({ opening: 85, middlegame: 75, endgame: 55 });
    expect(memory.weakestPhase(m)).toEqual({ weak: 'endgame', weakAcc: 55, best: 'opening', bestAcc: 85 });
  });

  it('stays fast on a full history (30 games, 20 mistakes each)', async () => {
    // mateInOne used to play out every legal move; memory runs it for every
    // mistake in 30 games, which took 17.8 s on a real account.
    const dbm = await import('../src/db.js');
    const { SCORING_VERSION } = await import('../src/chess/classifier.js');
    dbm.db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (3, 'busy', 'x', 'user')`).run();
    const moves = Array.from({ length: 20 }, () => ({
      ply: 6, san: 'Nf6', uci: 'g8f6', fen_before: SCHOLAR, fen_after: AFTER_NF6, eval_before_cp: 20, eval_after_cp: 10000,
      mate_before: null, mate_after: 1, best_move_uci: 'g7g6', best_move_san: 'g6', best_pv: [], centipawn_loss: 900, classification: 'mistake',
    }));
    for (let i = 0; i < 30; i++) {
      const id = 100 + i;
      dbm.db.prepare(`INSERT INTO games (id, user_id, source, pgn, user_color) VALUES (?, 3, 'played', '', 'black')`).run(id);
      dbm.db.prepare(`INSERT INTO analyses (game_id, depth, moves_json, scoring_version) VALUES (?, 16, ?, ?)`).run(id, JSON.stringify(moves), SCORING_VERSION);
    }
    const t = Date.now();
    const m = memory.playerMemory(3);
    expect(m.mistakeGames.allowed_mate).toBe(30);
    expect(Date.now() - t).toBeLessThan(6000);
  });

  it('knows nothing about a player without games', () => {
    expect(memory.playerMemory(2).gamesReviewed).toBe(0);
    expect(memory.weakestPhase(memory.playerMemory(2))).toBeNull();
  });
});

// ── End to end through /api/coach ───────────────────────────────────────────

async function post(path: string, body: unknown) {
  const res = await coach.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let text = '';
  let actions: unknown = null;
  for (const block of raw.split('\n\n')) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    if (event === 'message') text += data.join('\n');
    if (event === 'actions') actions = JSON.parse(data.join('\n'));
  }
  return { status: res.status, text, actions };
}

const explainBody = {
  fen: SCHOLAR, player: 'Black', played_san: 'Nf6', best_san: 'g6', classification: 'blunder',
  cp_loss: 9000, history: HISTORY, user_perspective: true,
};

describe('POST /explain (regression #37)', () => {
  it('gives the opponent\'s answer as a short line, not just one move', async () => {
    const prev = coaching.setCoachEngine(async (fen) => (fen === AFTER_NF6 ? [{ cp: 300, mate: null, pv: ['c4f7', 'e8e7', 'f7b3', 'a7a6'] }] : ENGINE[fen] ?? null));
    try {
      const c = await coaching.explainCoaching(blunderInput, 'en', 'beginner');
      expect(c.facts.opponent_reply).toBe(
        "The opponent's best answer: the bishop takes the pawn on f7 (check), the king from e8 to e7, the bishop from f7 to b3.",
      );
    } finally {
      coaching.setCoachEngine(prev);
    }
  });

  it('never sends a praising answer: it retries with a correction', async () => {
    replies = [PRAISE_37, GOOD_ANSWER];
    const r = await post('/explain', explainBody);
    expect(r.text).toBe(GOOD_ANSWER);
    expect(r.text).not.toMatch(/great development/i);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.user).toContain('IMPORTANT: your previous answer contradicted FACTS.verdict');
  });

  it('falls back to the facts when the model keeps praising', async () => {
    replies = [PRAISE_37, PRAISE_37];
    const r = await post('/explain', explainBody);
    expect(r.text.startsWith('A blunder')).toBe(true);
    expect(r.text).toContain('checkmate at once');
    expect(r.text).not.toMatch(/great development/i);
  });

  it('gives the model the reasons first and no example to copy', async () => {
    replies = [GOOD_ANSWER];
    const r = await post('/explain', explainBody);
    expect(r.text).toBe(GOOD_ANSWER);
    expect(r.actions).toEqual([{ kind: 'learn', lesson: 'mate-in-one' }, { kind: 'train' }]);
    const { system, user } = prompts[0]!;
    expect(system).not.toMatch(/Solid development|EXAMPLE/);
    expect(system).toContain('Praise ONLY when FACTS.tone is "praise"');
    expect(user.indexOf('"tone": "correct"')).toBeLessThan(user.indexOf('"material_balance"'));
    expect(user).toContain('checkmate at once');
    expect(user).toContain('No praise at all.');
    // Play sends no evaluation; the coach's engine run fills it in.
    expect(user).toContain('"win_pct_after": 0');
  });

  it('lets a correct answer through on the first try', async () => {
    replies = [GOOD_ANSWER];
    await post('/explain', explainBody);
    expect(prompts).toHaveLength(1);
  });
});

describe('POST /hint', () => {
  it('points at what matters without naming the move', async () => {
    replies = ['Your king has a problem on f7. What can you do about the checkmate threat?'];
    const r = await post('/hint', { fen: SCHOLAR, history: HISTORY });
    expect(r.text).toContain('checkmate threat');
    const { user } = prompts[0]!;
    expect(user).toContain('The opponent threatens checkmate on the next move.');
    expect(user).toContain('What the engine\'s best move does: it stops the checkmate threat');
    expect(user).toContain('allowing a quick checkmate');
    expect(user).not.toContain('pawn to g6');
    expect(user).toContain('Do NOT name the best move');
  });
});
