import type { Audience, Language, Classification } from '../types.js';

const TONE: Record<Audience, Record<Language, string>> = {
  kid: {
    en: 'You are a warm, patient chess coach for a 7-10 year old child. Look CAREFULLY at the board diagram below before saying anything — only mention pieces and squares that actually appear on the board. Never invent pieces or moves. Use very simple words, short sentences, and friendly encouragement. Compare pieces to characters when helpful (the knight is a horsey, the bishop is a wizard). 2-4 short sentences total.',
    bg: 'Ти си мил и търпелив шах треньор за дете на 7-10 години. Прегледай ВНИМАТЕЛНО диаграмата на дъската по-долу преди да кажеш нещо — споменавай само фигури и полета, които наистина са на дъската. Никога не измисляй фигури или ходове. Използвай много прости думи, кратки изречения и приятелско окуражение. Сравнявай фигурите с герои, когато помага (конят е кончето, офицерът е магьосникът). Общо 2-4 кратки изречения.',
  },
  beginner: {
    en: 'You are a friendly chess coach for a beginner. Look CAREFULLY at the board diagram below — only reference pieces and squares that actually exist on it. Explain in plain language. Briefly mention the principle behind the move (king safety, piece activity, controlling the center, etc.). 3-5 sentences max.',
    bg: 'Ти си приятелски настроен шах треньор за начинаещ. Прегледай ВНИМАТЕЛНО диаграмата на дъската по-долу — споменавай само фигури и полета, които наистина съществуват на нея. Обяснявай на прост език. Накратко спомени принципа зад хода (безопасност на царя, активност на фигурите, контрол на центъра и т.н.). Максимум 3-5 изречения.',
  },
  intermediate: {
    en: 'You are a chess coach. Look at the board diagram below carefully — every piece and square you mention must actually be on the board. Explain moves with concrete tactical and strategic reasoning. Use standard chess terminology. 3-5 sentences.',
    bg: 'Ти си шах треньор. Прегледай ВНИМАТЕЛНО диаграмата на дъската по-долу — всяка фигура и поле, които споменаваш, трябва наистина да са на дъската. Обяснявай ходовете с конкретни тактически и стратегически разсъждения. Използвай стандартна шах терминология. 3-5 изречения.',
  },
  advanced: {
    en: 'You are a chess coach for an advanced club player. Use the board diagram below as ground truth — only reference pieces actually present. Discuss positional themes, candidate moves, key squares, and longer-term plans. Be precise and concise. 3-6 sentences.',
    bg: 'Ти си шах треньор за напреднал клубен играч. Използвай диаграмата на дъската по-долу като база — споменавай само фигури, които наистина присъстват. Обсъждай позиционни теми, кандидат ходове, ключови полета и дългосрочни планове. Бъди точен и стегнат. 3-6 изречения.',
  },
};

export function systemPrompt(audience: Audience, language: Language): string {
  return TONE[audience][language];
}

const PIECE_NAME_EN: Record<string, string> = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
const PIECE_NAME_BG: Record<string, string> = { K: 'Цар', Q: 'Дама', R: 'Топ', B: 'Офицер', N: 'Кон', P: 'Пешка' };

// Convert a FEN board into an ASCII diagram + a piece inventory. LLMs (especially
// smaller open-weight ones) hallucinate pieces and squares when given a raw FEN
// string. Giving them a human-readable diagram + an explicit list of "what is
// where" dramatically reduces invented-piece errors.
export function fenToContext(fen: string, language: Language = 'en'): string {
  const parts = fen.split(' ');
  const board = parts[0] ?? '';
  const turn = parts[1] === 'w' ? (language === 'bg' ? 'Бели' : 'White') : (language === 'bg' ? 'Черни' : 'Black');

  const rows = board.split('/');
  const ascii: string[] = [];
  const white: Record<string, string[]> = { K: [], Q: [], R: [], B: [], N: [], P: [] };
  const black: Record<string, string[]> = { K: [], Q: [], R: [], B: [], N: [], P: [] };

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
        const inv = ch === ch.toUpperCase() ? white : black;
        inv[piece]?.push(sq);
        file++;
      }
    }
    ascii.push(line.trimEnd());
  }
  ascii.push('    a b c d e f g h');

  const names = language === 'bg' ? PIECE_NAME_BG : PIECE_NAME_EN;
  function inv(side: Record<string, string[]>): string {
    const order = ['K', 'Q', 'R', 'B', 'N', 'P'];
    const parts: string[] = [];
    for (const k of order) {
      if (side[k]!.length > 0) parts.push(`${names[k]}: ${side[k]!.join(', ')}`);
    }
    return parts.join('; ');
  }

  const whiteHdr = language === 'bg' ? 'Бели фигури' : 'White pieces';
  const blackHdr = language === 'bg' ? 'Черни фигури' : 'Black pieces';
  const turnHdr  = language === 'bg' ? 'На ход' : 'To move';

  return [
    ascii.join('\n'),
    '',
    `${whiteHdr}: ${inv(white) || '—'}`,
    `${blackHdr}: ${inv(black) || '—'}`,
    `${turnHdr}: ${turn}`,
  ].join('\n');
}

interface MoveContext {
  fen: string;
  player: 'White' | 'Black';
  played_san: string;
  best_san: string | null;
  classification: Classification;
  cp_loss: number;
  pv_san?: string[];
  user_perspective?: boolean; // when true, "you played"; when false, "white/black played"
}

export function explainMovePrompt(ctx: MoveContext, language: Language): string {
  const board = fenToContext(ctx.fen, language);

  const playerLabel = ctx.user_perspective
    ? (language === 'bg' ? 'Ти' : 'You')
    : (language === 'bg' ? (ctx.player === 'White' ? 'Бели' : 'Черни') : ctx.player);

  const head = language === 'bg'
    ? `Дъска (преди хода):\n${board}\n\n${playerLabel} изигра: ${ctx.played_san}.`
    : `Board (before the move):\n${board}\n\n${playerLabel} played: ${ctx.played_san}.`;

  const best = ctx.best_san && ctx.best_san !== ctx.played_san
    ? (language === 'bg'
        ? `Двигателят препоръчва вместо това: ${ctx.best_san}.`
        : `The engine recommends instead: ${ctx.best_san}.`)
    : (language === 'bg'
        ? `Това е най-добрият ход според двигателя.`
        : `This was the engine's top choice.`);

  const klass = (() => {
    const map: Record<Classification, [string, string]> = {
      brilliant: ['a brilliant move (sacrifice)', 'брилянтен ход (жертва)'],
      best: ['the best move', 'най-добър ход'],
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
        ? `\n\nОбясни на мен (играча) какво направих и защо ходът е такъв. Започни директно с обяснението — без преразказ на позицията. Споменавай само реално присъстващи фигури.`
        : `\n\nExplain to me (the player) what I did and why this move is rated this way. Jump straight into the explanation — don't restate the position. Only reference pieces that are actually on the board.`)
    : (language === 'bg'
        ? `\n\nОбясни ясно защо ходът е такъв, какво се пропуска или какво се постига. Започни директно с обяснението. Споменавай само реално присъстващи фигури.`
        : `\n\nExplain clearly why this is the case — what was missed or achieved. Jump straight into the explanation. Only reference pieces that are actually on the board.`);

  return `${head}\n${best}\n${klass}${pv}${ask}`;
}

export function hintPrompt(fen: string, audience: Audience, language: Language): string {
  const board = fenToContext(fen, language);
  if (language === 'bg') {
    return audience === 'kid'
      ? `Дъска:\n${board}\n\nДай ми много малък намек какво да гледам в тази позиция, без да казваш конкретен ход. Едно изречение, простичко. Не измисляй фигури.`
      : `Дъска:\n${board}\n\nДай ми концептуален намек какво да търся (тактически мотив, слабо поле, и т.н.) без да казваш конкретен ход. Едно-две изречения. Споменавай само реално присъстващи фигури.`;
  }
  return audience === 'kid'
    ? `Board:\n${board}\n\nGive me a tiny hint about what to look at in this position — don't tell me a specific move. One simple sentence. Only mention pieces that are actually on the board.`
    : `Board:\n${board}\n\nGive me a conceptual hint about what to look for (a tactical motif, a weak square, etc.) — don't reveal a concrete move. One or two sentences. Only reference pieces that are actually on the board.`;
}
