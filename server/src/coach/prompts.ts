import { Chess } from 'chess.js';
import type { Audience, Language, Classification } from '../types.js';

const TONE: Record<Audience, Record<Language, string>> = {
  kid: {
    en: `You are a warm, patient chess coach for a 7–10 year old.
HARD RULE: Look at the board diagram below. Only mention pieces and squares that are actually on it. NEVER invent pieces, NEVER suggest a piece moves from a square it isn't on. If unsure, just talk about general ideas.
TONE: Use simple words. Compare pieces to characters when it helps (the knight is a horsey, the bishop is a wizard, the queen is the strongest). Be encouraging — even a mistake is a learning chance.
LENGTH: 2–3 short sentences total. No bullet lists.`,
    bg: `Ти си мил и търпелив шах треньор за дете на 7–10 години.
ТВЪРДО ПРАВИЛО: Гледай диаграмата на дъската по-долу. Споменавай САМО фигури и полета, които наистина са там. НИКОГА не измисляй фигури и НИКОГА не предлагай ход на фигура, която не е на това поле. Ако не си сигурен, говори за общи идеи.
ТОН: Прости думи. Сравнявай фигурите с герои (конят е кончето, офицерът е магьосникът, дамата е най-силната). Бъди окуражителен — и грешката е урок.
ДЪЛЖИНА: Общо 2–3 кратки изречения. Без списъци.`,
  },
  beginner: {
    en: `You are a friendly chess coach for a beginner.
HARD RULE: Look at the board below — only reference pieces/squares actually on it. Never invent pieces, never claim a move that isn't legal. If something seems off, fall back to general principles.
STYLE: Plain language, mention the principle behind the move (king safety, development, control of the center, piece activity). Encourage when something is right.
LENGTH: 3–5 short sentences max.`,
    bg: `Ти си приятелски шах треньор за начинаещ.
ТВЪРДО ПРАВИЛО: Гледай дъската по-долу — споменавай САМО фигури/полета, които наистина са там. Не измисляй фигури, не предлагай нелегален ход. Ако нещо не пасва, говори общо за принципи.
СТИЛ: Прост език, винаги спомени принципа (безопасност на царя, развитие, контрол на центъра, активност). Окуражавай когато ходът е добър.
ДЪЛЖИНА: Максимум 3–5 кратки изречения.`,
  },
  intermediate: {
    en: `You are a chess coach for an intermediate player.
HARD RULE: Use the board diagram below as ground truth. Every piece, square and move you mention must actually exist on it. If you can't be specific, stay general.
STYLE: Concrete tactical and strategic reasoning. Standard chess terminology. Reference squares (e.g. d4, f7) and piece coordinates (Nf3, Bc4). Compare candidate moves when useful.
LENGTH: 3–5 sentences.`,
    bg: `Ти си шах треньор за играч със средно ниво.
ТВЪРДО ПРАВИЛО: Използвай диаграмата като база. Всяка фигура, поле и ход, който споменаваш, трябва наистина да е на нея. Ако не можеш да си конкретен, говори общо.
СТИЛ: Конкретни тактически и стратегически разсъждения. Стандартна терминология. Споменавай полета (d4, f7) и координати на фигури (Nf3, Bc4). Сравнявай кандидат-ходове.
ДЪЛЖИНА: 3–5 изречения.`,
  },
  advanced: {
    en: `You are a chess coach for an advanced club player.
HARD RULE: The board diagram below is the only source of truth. Do not mention any piece or square not present. Do not invent variations.
STYLE: Discuss positional themes, candidate moves, key squares, pawn structure, longer-term plans. Be precise. When you mention a tactic, identify the motif (pin, fork, discovered attack, deflection, etc.).
LENGTH: 3–6 sentences.`,
    bg: `Ти си шах треньор за напреднал клубен играч.
ТВЪРДО ПРАВИЛО: Диаграмата е единствен източник на истина. Не споменавай фигура/поле, което го няма. Не измисляй варианти.
СТИЛ: Позиционни теми, кандидат-ходове, ключови полета, пешечна структура, дългосрочни планове. Бъди точен. Когато споменаваш тактика — идентифицирай мотива (пирон, вилица, скрита атака, и т.н.).
ДЪЛЖИНА: 3–6 изречения.`,
  },
};

export function systemPrompt(audience: Audience, language: Language): string {
  return TONE[audience][language];
}

const PIECE_NAME_EN: Record<string, string> = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
const PIECE_NAME_BG: Record<string, string> = { K: 'Цар', Q: 'Дама', R: 'Топ', B: 'Офицер', N: 'Кон', P: 'Пешка' };
const PIECE_VALUE: Record<string, number> = { K: 0, Q: 9, R: 5, B: 3, N: 3, P: 1 };

interface BoardContext {
  ascii: string;
  whiteInv: string;
  blackInv: string;
  turn: 'white' | 'black';
  inCheck: boolean;
  capturedByWhite: string;
  capturedByBlack: string;
  materialBalance: number;
}

function fenToBoardContext(fen: string, language: Language): BoardContext {
  const parts = fen.split(' ');
  const board = parts[0] ?? '';
  const turn: 'white' | 'black' = parts[1] === 'w' ? 'white' : 'black';

  const rows = board.split('/');
  const ascii: string[] = [];
  const counts = { white: { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0 } as Record<string, number>, black: { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0 } as Record<string, number> };
  const inv: { white: Record<string, string[]>; black: Record<string, string[]> } = {
    white: { K: [], Q: [], R: [], B: [], N: [], P: [] },
    black: { K: [], Q: [], R: [], B: [], N: [], P: [] },
  };

  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    let line = `${rank} | `;
    let file = 0;
    for (const ch of rows[r] ?? '') {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) { line += '. '; file++; }
      } else {
        line += ch + ' ';
        const sq = String.fromCharCode(97 + file) + rank;
        const piece = ch.toUpperCase();
        if (ch === ch.toUpperCase()) { counts.white[piece] = (counts.white[piece] ?? 0) + 1; inv.white[piece]?.push(sq); }
        else { counts.black[piece] = (counts.black[piece] ?? 0) + 1; inv.black[piece]?.push(sq); }
        file++;
      }
    }
    ascii.push(line.trimEnd());
  }
  ascii.push('    a b c d e f g h');

  const names = language === 'bg' ? PIECE_NAME_BG : PIECE_NAME_EN;
  function fmtInv(side: Record<string, string[]>): string {
    const order = ['K', 'Q', 'R', 'B', 'N', 'P'];
    const parts: string[] = [];
    for (const k of order) {
      const list = side[k];
      if (list && list.length > 0) parts.push(`${names[k]}: ${list.join(',')}`);
    }
    return parts.join(' | ') || '—';
  }

  // Captured pieces = starting count minus current count
  // Starting counts: K1, Q1, R2, B2, N2, P8
  const startCounts = { K: 1, Q: 1, R: 2, B: 2, N: 2, P: 8 };
  function capturedFrom(curr: Record<string, number>): { list: string; value: number } {
    const lost: string[] = [];
    let value = 0;
    for (const [k, n] of Object.entries(startCounts)) {
      const missing = n - (curr[k] ?? 0);
      if (missing > 0) {
        for (let i = 0; i < missing; i++) { lost.push(names[k]!); value += PIECE_VALUE[k] ?? 0; }
      }
    }
    return { list: lost.length ? lost.join(', ') : '—', value };
  }
  // Black captured pieces = white pieces missing (and vice versa)
  const blackTook = capturedFrom(counts.white); // white pieces lost = captured by black
  const whiteTook = capturedFrom(counts.black);

  // In-check detection via chess.js (more reliable than parsing FEN)
  let inCheck = false;
  try {
    const c = new Chess(fen);
    inCheck = c.isCheck();
  } catch { /* ignore */ }

  return {
    ascii: ascii.join('\n'),
    whiteInv: fmtInv(inv.white),
    blackInv: fmtInv(inv.black),
    turn,
    inCheck,
    capturedByWhite: whiteTook.list,
    capturedByBlack: blackTook.list,
    materialBalance: whiteTook.value - blackTook.value, // positive = white ahead
  };
}

// Public: simple FEN→annotated text used by smaller helper functions.
export function fenToContext(fen: string, language: Language = 'en'): string {
  const ctx = fenToBoardContext(fen, language);
  const turnLabel = language === 'bg'
    ? (ctx.turn === 'white' ? 'Бели' : 'Черни')
    : (ctx.turn === 'white' ? 'White' : 'Black');
  const headers = language === 'bg'
    ? { whiteHdr: 'Бели фигури', blackHdr: 'Черни фигури', turnHdr: 'На ход', checkHdr: 'Шах', capW: 'Бели взеха', capB: 'Черни взеха', mat: 'Материален баланс' }
    : { whiteHdr: 'White pieces', blackHdr: 'Black pieces', turnHdr: 'To move', checkHdr: 'In check', capW: 'White has captured', capB: 'Black has captured', mat: 'Material balance' };
  const matSign = ctx.materialBalance > 0 ? `+${ctx.materialBalance}` : `${ctx.materialBalance}`;
  return [
    ctx.ascii,
    '',
    `${headers.whiteHdr}: ${ctx.whiteInv}`,
    `${headers.blackHdr}: ${ctx.blackInv}`,
    `${headers.capW}: ${ctx.capturedByWhite}`,
    `${headers.capB}: ${ctx.capturedByBlack}`,
    `${headers.mat}: ${matSign} (white perspective)`,
    `${headers.turnHdr}: ${turnLabel}${ctx.inCheck ? `  [${headers.checkHdr}]` : ''}`,
  ].join('\n');
}

// Recent move history — last N plies in SAN, formatted like "12. e4 e5 13. Nf3 Nc6"
export function recentMovesSan(fen: string, history: string[], maxPlies = 8): string {
  if (!history.length) return '—';
  const start = Math.max(0, history.length - maxPlies);
  const slice = history.slice(start);
  const startMoveNum = Math.floor(start / 2) + 1;
  const startedOnBlack = (start % 2) === 1;
  const out: string[] = [];
  let n = startMoveNum;
  let i = 0;
  if (startedOnBlack) {
    out.push(`${n}...${slice[i]!}`);
    i++; n++;
  }
  while (i < slice.length) {
    const w = slice[i]; const b = slice[i + 1];
    out.push(`${n}.${w}${b ? ' ' + b : ''}`);
    i += 2; n++;
  }
  return out.join(' ');
  void fen;
}

interface MoveContext {
  fen: string;
  player: 'White' | 'Black';
  played_san: string;
  best_san: string | null;
  classification: Classification;
  cp_loss: number;
  pv_san?: string[];
  history?: string[];   // full history in SAN, used to surface recent moves
  user_perspective?: boolean;
}

export function explainMovePrompt(ctx: MoveContext, language: Language): string {
  const board = fenToContext(ctx.fen, language);
  const recent = recentMovesSan(ctx.fen, ctx.history ?? [], 8);

  const playerLabel = ctx.user_perspective
    ? (language === 'bg' ? 'Ти' : 'You')
    : (language === 'bg' ? (ctx.player === 'White' ? 'Бели' : 'Черни') : ctx.player);

  const head = language === 'bg'
    ? `Дъска (преди хода):\n${board}\n\nПоследни ходове: ${recent}\n${playerLabel} изигра: ${ctx.played_san}.`
    : `Board (before the move):\n${board}\n\nRecent moves: ${recent}\n${playerLabel} played: ${ctx.played_san}.`;

  const best = ctx.best_san && ctx.best_san !== ctx.played_san
    ? (language === 'bg'
        ? `Двигателят препоръчва вместо това: ${ctx.best_san}.`
        : `The engine recommends instead: ${ctx.best_san}.`)
    : (language === 'bg'
        ? `Това е най-добрият ход според двигателя.`
        : `This was the engine's top choice.`);

  const klass = (() => {
    const map: Record<Classification, [string, string]> = {
      brilliant: ['a brilliant move (sacrifice that holds)', 'брилянтен ход (жертва, която държи)'],
      best: ['the best move', 'най-добрият ход'],
      excellent: ['excellent', 'отличен ход'],
      good: ['good', 'добър ход'],
      book: ['a book move', 'теоретичен ход'],
      inaccuracy: ['an inaccuracy', 'неточност'],
      mistake: ['a mistake', 'грешка'],
      blunder: ['a blunder', 'голяма грешка (блъндер)'],
      miss: ['a miss (a much stronger move was available)', 'пропуск (имаше много по-силен ход)'],
    };
    const [en, bg] = map[ctx.classification];
    return language === 'bg'
      ? `Класификация: ${bg} (загуба ${ctx.cp_loss} стотни от пешка).`
      : `Classification: ${en} (cp loss ${ctx.cp_loss}).`;
  })();

  const pv = ctx.pv_san && ctx.pv_san.length
    ? (language === 'bg'
        ? `\nПредложен вариант: ${ctx.pv_san.slice(0, 6).join(' ')}`
        : `\nSuggested line: ${ctx.pv_san.slice(0, 6).join(' ')}`)
    : '';

  const ask = ctx.user_perspective
    ? (language === 'bg'
        ? `\n\nОбясни на мен (играча) какво направих и защо ходът е оценен така. Започни директно. Споменавай само фигури от дъската.`
        : `\n\nExplain to me (the player) what I did and why this move is rated this way. Jump straight in. Only reference pieces actually on the board.`)
    : (language === 'bg'
        ? `\n\nОбясни ясно защо ходът е такъв. Започни директно. Споменавай само фигури от дъската.`
        : `\n\nExplain clearly why this is the case. Jump straight in. Only reference pieces actually on the board.`);

  return `${head}\n${best}\n${klass}${pv}${ask}`;
}

export function hintPrompt(fen: string, audience: Audience, language: Language, history: string[] = []): string {
  const board = fenToContext(fen, language);
  const recent = recentMovesSan(fen, history, 6);
  const recentLine = history.length ? (language === 'bg' ? `\nПоследни ходове: ${recent}` : `\nRecent moves: ${recent}`) : '';
  if (language === 'bg') {
    return audience === 'kid'
      ? `Дъска:\n${board}${recentLine}\n\nДай ми малък намек какво да гледам в тази позиция, без да казваш конкретен ход. Едно изречение, простичко. Не измисляй фигури.`
      : `Дъска:\n${board}${recentLine}\n\nДай ми концептуален намек какво да търся (тактически мотив, слабо поле, и т.н.) без да казваш конкретен ход. Едно-две изречения. Само реално присъстващи фигури.`;
  }
  return audience === 'kid'
    ? `Board:\n${board}${recentLine}\n\nGive me a tiny hint about what to look at in this position — don't tell me a specific move. One simple sentence. Only mention pieces actually on the board.`
    : `Board:\n${board}${recentLine}\n\nGive me a conceptual hint about what to look for (a tactical motif, a weak square, etc.) — don't reveal a concrete move. One or two sentences. Only reference pieces actually on the board.`;
}
