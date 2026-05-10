import { Chess } from 'chess.js';
import type { Audience, Language, Classification } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Coach prompt design (rewritten 5.0.0 for chess.com Game Review parity):
//
// THREE-SECTION SCAFFOLD: PERSONA → HARD RULES → TASK CONTRACT.
// Each call builds a system prompt with these three blocks (the persona +
// hard rules are stable; the task contract varies per call type) and a user
// message that contains a JSON FACTS object followed by a one-line TASK
// directive. No ASCII board, no SAN — every piece of context is pre-rendered
// in natural language in the requested output language so a small LLM never
// sees information it isn't allowed to repeat.
//
// Why three sections: small models (1B-7B) follow stable structural headers
// dramatically better than free prose. Audience tuning lives in the persona
// block; anti-hallucination lives in the hard rules; the task contract has
// only the directive ("explain", "hint", "describe key moment"). This split
// is what gives us chess.com-narrator tone while keeping the model honest.
//
// Spec: .claude/specs/coach.md §2, §3, §5.
// ─────────────────────────────────────────────────────────────────────────────

const PIECE_NAME_EN: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
const PIECE_NAME_BG: Record<string, string> = { K: 'цар', Q: 'дама', R: 'топ', B: 'офицер', N: 'кон', P: 'пешка' };
const PIECE_NAME_KID_EN: Record<string, string> = { K: 'king', Q: 'queen', R: 'castle', B: 'bishop', N: 'horsey', P: 'pawn' };
const PIECE_NAME_KID_BG: Record<string, string> = { K: 'цар', Q: 'дама', R: 'топче', B: 'офицер', N: 'конче', P: 'пешка' };
const PIECE_VALUE: Record<string, number> = { K: 0, Q: 9, R: 5, B: 3, N: 3, P: 1 };

export function pieceNames(language: Language, audience: Audience): Record<string, string> {
  if (audience === 'kid') return language === 'bg' ? PIECE_NAME_KID_BG : PIECE_NAME_KID_EN;
  return language === 'bg' ? PIECE_NAME_BG : PIECE_NAME_EN;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona / audience block — chess.com-narrator voice, audience-tuned.
// ─────────────────────────────────────────────────────────────────────────────

interface AudienceBlock {
  tone: string;
  sentences: string;
  allowed: string;
  banned: string;
}

const AUDIENCE_EN: Record<Audience, AudienceBlock> = {
  kid: {
    tone: 'Warm, gentle, encouraging. Mistakes are "oops", not "errors". Pieces are characters: the knight is a horsey, the rook is a castle.',
    sentences: '2 short sentences, 6-12 words each.',
    allowed: 'simple words; piece names; "looks", "watching", "safe", "attack", "defend"',
    banned: 'blunder, evaluation, prophylaxis, outpost, tempo, initiative, pin, skewer, discovered attack, weak square',
  },
  beginner: {
    tone: 'Friendly, instructional, principle-first. Name ONE concept per moment (king safety, development, counting attackers/defenders).',
    sentences: '3 short sentences, 10-18 words each.',
    allowed: 'king safety, development, center, capture, attack, defend, threat, piece value',
    banned: 'prophylaxis, outpost, minority attack, restraint, zugzwang, fortress, undermining',
  },
  intermediate: {
    tone: 'Concrete sport-commentary. Name standard tactical and positional motifs by name.',
    sentences: '3-5 sentences, 14-22 words each.',
    allowed: 'pin, fork, skewer, discovered attack, deflection, overload, weak square, outpost, open file, pawn structure, king safety, piece activity, tempo, initiative',
    banned: 'prophylaxis, minority attack, zugzwang, fortress, restraint, undermining',
  },
  advanced: {
    tone: 'Peer-to-peer, fast, motif-dense. Plan and key squares matter more than basics.',
    sentences: '3-6 sentences, 16-26 words each.',
    allowed: 'prophylaxis, minority attack, restraint, undermining, breakthrough, fortress, zugzwang, opposition, triangulation, plus all intermediate vocabulary',
    banned: '(no banned list at this tier — write peer-to-peer)',
  },
};

const AUDIENCE_BG: Record<Audience, AudienceBlock> = {
  kid: {
    tone: 'Мил, нежен, насърчителен. Грешките са "опс", не "грешки". Фигурите са герои: конят е кончето, топът е топчето.',
    sentences: '2 кратки изречения, 6-12 думи всяко.',
    allowed: 'прости думи; имена на фигури; "гледа", "пази", "атакува", "защитава"',
    banned: 'блъндер, оценка, профилактика, аванпост, темпо, инициатива, пирон, шиш, скрит удар, слабо поле',
  },
  beginner: {
    tone: 'Приятелски, обучаващ, принципно ориентиран. Назовавай ЕДИН принцип на момент (безопасност на царя, развитие, атакуващи и защитници).',
    sentences: '3 кратки изречения, 10-18 думи всяко.',
    allowed: 'безопасност на царя, развитие, център, взимане, атака, защита, заплаха, стойност на фигура',
    banned: 'профилактика, аванпост, малцинствена атака, ограничение, цугцванг, крепост, подкопаване',
  },
  intermediate: {
    tone: 'Конкретен спортен коментар. Назовавай стандартни тактически и позиционни мотиви.',
    sentences: '3-5 изречения, 14-22 думи всяко.',
    allowed: 'пирон, вилица, шиш, скрит удар, отклонение, претоварване, слабо поле, аванпост, отворена линия, пешечна структура, безопасност на царя, активност на фигурите, темпо, инициатива',
    banned: 'профилактика, малцинствена атака, цугцванг, крепост, ограничение, подкопаване',
  },
  advanced: {
    tone: 'Колега до колега, бързо, мотиви плътно. Планът и ключовите полета имат значение повече от основите.',
    sentences: '3-6 изречения, 16-26 думи всяко.',
    allowed: 'профилактика, малцинствена атака, ограничение, подкопаване, пробив, крепост, цугцванг, опозиция, триангулация и цялата средна лексика',
    banned: '(няма забранен списък на това ниво — пиши колега до колега)',
  },
};

function audienceBlock(audience: Audience, language: Language): string {
  const b = language === 'bg' ? AUDIENCE_BG[audience] : AUDIENCE_EN[audience];
  if (language === 'bg') {
    return `Аудитория: ${audience}.\nТОН: ${b.tone}\nДЪЛЖИНА: ${b.sentences}\nРАЗРЕШЕНИ ПОНЯТИЯ: ${b.allowed}.\nЗАБРАНЕНИ ПОНЯТИЯ: ${b.banned}.`;
  }
  return `Audience: ${audience}.\nTONE: ${b.tone}\nLENGTH: ${b.sentences}\nALLOWED CONCEPTS: ${b.allowed}.\nBANNED CONCEPTS: ${b.banned}.`;
}

const PERSONA_EN = `=== PERSONA ===
You are Patzer's chess coach. Your voice is Chess.com's Game Review narrator: warm, friendly, sport-commentary energy, never condescending, always concrete. You speak directly to the player as "you".`;

const PERSONA_BG = `=== ПЕРСОНА ===
Ти си шах треньорът на Patzer. Гласът ти е този на разказвача в Game Review на Chess.com: топъл, приятелски, спортно-коментарна енергия, никога снизходителен, винаги конкретен. Говориш директно на играча с "ти".`;

const HARD_RULES_EN = `=== HARD RULES ===
You are a RENDERER, not an analyst. The user message contains a JSON object named FACTS that has already been computed by Stockfish + chess.js. Your only job is to phrase those facts in the persona above.

R1. Use only what is in FACTS. Never name a piece, square, capture, threat, move, or continuation that is not in FACTS. If FACTS does not include it, it does not exist.
R2. Never write chess notation (Nf3, Bxh7, O-O, Qd2+). Use natural language only. Squares (h7, e4) on their own are fine.
R3. Never invent continuations past FACTS.engine_pv. If engine_pv has N entries, describe at most N follow-up moves.
R4. Never claim winning / losing / mating unless FACTS.forced_mate_in is set or FACTS.verdict says so. Quote FACTS.verdict verbatim when describing the engine's overall judgement.
R5. Output language: English. Every word in English. Translate piece names (queen, knight, etc.).
R6. Length cap: see the audience block. No bullet lists, no headings, no markdown unless TASK asks for JSON.
R7. Begin directly with the explanation. No "Sure!", "Of course!", "Let me explain", "Here's what happened", or repeating the question.
R8. One praise phrase per response, maximum ("nicely done", "great find", "well played"). Never praise a mistake, blunder, or inaccuracy.
R9. Use only ALLOWED CONCEPTS from the audience block. Never use a BANNED CONCEPT.
R10. Don't say "in this position" / "as we can see" / "let's dive in" / "overall" / "in conclusion" — those are AI tells. Sound like a sportscaster, not a textbook.`;

const HARD_RULES_BG = `=== ТВЪРДИ ПРАВИЛА ===
Ти си РЕНДЕРЕР, не анализатор. В съобщението има JSON обект FACTS, който вече е изчислен от Stockfish + chess.js. Единствената ти задача е да преведеш фактите в гласа на персоната по-горе.

R1. Използвай само това, което е във FACTS. Не споменавай фигура, поле, взимане, заплаха, ход или продължение, което не е във FACTS.
R2. Никога не използвай шахматна нотация (Кf3, Оxh7, 0-0, Дd2+). Само естествен език. Полета (h7, e4) сами по себе си са ок.
R3. Не измисляй продължения извън FACTS.engine_pv. Ако engine_pv има N хода, опиши най-много N последващи хода.
R4. Не казвай "печели" / "губи" / "матиран" освен ако FACTS.forced_mate_in е зададено или FACTS.verdict го казва. Цитирай FACTS.verdict дословно за общата оценка.
R5. Език на изхода: български. Всяка дума на български. Превеждай имената на фигурите (дама, кон, и т.н.).
R6. Лимит на дължина: виж блока за аудиторията. Без списъци, без заглавия, без markdown освен ако TASK не иска JSON.
R7. Започвай директно с обяснението. Без "Разбира се!", "Нека ти обясня", "Ето какво се случи" или повтаряне на въпроса.
R8. Една похвална фраза на отговор, максимум ("страхотно", "браво", "добре изиграно"). Никога не хвали грешка, блъндер или неточност.
R9. Използвай само РАЗРЕШЕНИ ПОНЯТИЯ от блока за аудиторията. Никога ЗАБРАНЕНО ПОНЯТИЕ.
R10. Не казвай "в тази позиция" / "както виждаме" / "нека започнем" / "като цяло" / "в заключение" — това са AI-маркери. Звучи като спортен коментатор, не като учебник.`;

export function systemPrompt(audience: Audience, language: Language): string {
  if (language === 'bg') {
    return `${PERSONA_BG}\n\n${audienceBlock(audience, language)}\n\n${HARD_RULES_BG}`;
  }
  return `${PERSONA_EN}\n\n${audienceBlock(audience, language)}\n\n${HARD_RULES_EN}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Natural-language move rendering — converts a SAN move (in a given position)
// into "the knight takes on f7" prose. Language- AND audience-aware so a
// Bulgarian kid review gets "кончето на f7" while an English advanced review
// gets "the knight to f7". Used to build FACTS payloads — the LLM never sees
// SAN directly.
// ─────────────────────────────────────────────────────────────────────────────

export function sanToNatural(san: string, fenBefore: string, language: Language, audience: Audience): string {
  const names = pieceNames(language, audience);
  let res: ReturnType<Chess['move']> | null = null;
  try {
    const c = new Chess(fenBefore);
    res = c.move(san, { strict: false });
  } catch { /* fall through */ }
  if (!res) return san; // can't parse — fall back to SAN

  const flags = res.flags ?? '';
  if (flags.includes('k')) {
    return language === 'bg' ? 'къса рокада' : 'short castles';
  }
  if (flags.includes('q')) {
    return language === 'bg' ? 'дълга рокада' : 'long castles';
  }

  const piece = (res.piece || 'p').toUpperCase();
  const pieceName = names[piece] ?? names.P!;
  const captured = res.captured ? names[res.captured.toUpperCase()] : null;
  const isCheck = san.endsWith('+');
  const isMate = san.endsWith('#');
  const promo = res.promotion ? names[res.promotion.toUpperCase()] : null;

  let core: string;
  if (captured) {
    core = language === 'bg'
      ? `${pieceName} взема ${captured} на ${res.to}`
      : `the ${pieceName} takes the ${captured} on ${res.to}`;
  } else if (piece === 'P') {
    core = language === 'bg' ? `${pieceName} на ${res.to}` : `the ${pieceName} to ${res.to}`;
  } else {
    core = language === 'bg'
      ? `${pieceName} от ${res.from} на ${res.to}`
      : `the ${pieceName} from ${res.from} to ${res.to}`;
  }

  if (promo) {
    core += language === 'bg' ? `, повишена в ${promo}` : `, promoting to a ${promo}`;
  }

  if (isMate) core += language === 'bg' ? ' (мат)' : ' (checkmate)';
  else if (isCheck) core += language === 'bg' ? ' (шах)' : ' (check)';

  return core;
}

/** Replay a PV (UCI or SAN) through chess.js and render each move into the
 *  requested language. Max-length capped so prompts stay tight on small models. */
export function pvToNaturalSan(pvSan: string[], fromFen: string, language: Language, audience: Audience, max = 4): string[] {
  if (!pvSan.length) return [];
  const replay = new Chess(fromFen);
  const out: string[] = [];
  for (const s of pvSan.slice(0, max)) {
    const before = replay.fen();
    const phrase = sanToNatural(s, before, language, audience);
    try { replay.move(s, { strict: false }); } catch { break; }
    out.push(phrase);
  }
  return out;
}

/** Convert the last N plies of a SAN history into natural-language phrases for
 *  the FACTS.history_recent field. The LLM never sees SAN this way. */
export function recentMovesNatural(history: string[], language: Language, audience: Audience, maxPlies = 5): string[] {
  if (!history.length) return [];
  const start = Math.max(0, history.length - maxPlies);
  const replay = new Chess();
  // Replay from start up to `start` to catch up the position, then start emitting
  // natural-language renderings.
  for (let i = 0; i < start; i++) {
    try { replay.move(history[i]!, { strict: false }); } catch { /* fall through */ }
  }
  const out: string[] = [];
  for (let i = start; i < history.length; i++) {
    const before = replay.fen();
    const phrase = sanToNatural(history[i]!, before, language, audience);
    try { replay.move(history[i]!, { strict: false }); } catch { break; }
    out.push(phrase);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdict phrasing (used by FACTS.verdict — the LLM may quote verbatim)
// ─────────────────────────────────────────────────────────────────────────────

const CLASS_PHRASE_EN: Record<Classification, string> = {
  brilliant: 'a brilliant move — the engine\'s top pick AND a real sacrifice',
  great: 'a great move — the only move that held the position',
  best: 'the engine\'s top choice',
  excellent: 'an excellent move',
  good: 'a solid move',
  book: 'a known opening / theory move',
  forced: 'a forced move — the only legal option',
  inaccuracy: 'a small inaccuracy',
  mistake: 'a mistake — a meaningfully better move was on the board',
  blunder: 'a blunder — significant material or position lost',
  miss: 'a missed win — a much stronger move was available',
};
const CLASS_PHRASE_BG: Record<Classification, string> = {
  brilliant: 'брилянтен ход — топ изборът на двигателя И истинска жертва',
  great: 'страхотен ход — единственият, който държеше позицията',
  best: 'топ изборът на двигателя',
  excellent: 'отличен ход',
  good: 'солиден ход',
  book: 'теоретичен ход',
  forced: 'принуден ход — единственият легален',
  inaccuracy: 'малка неточност',
  mistake: 'грешка — имаше осезаемо по-добър ход',
  blunder: 'блъндер — губи значително',
  miss: 'пропуснат шанс — имаше много по-силен ход',
};

export function verdictPhrase(c: Classification, language: Language): string {
  return (language === 'bg' ? CLASS_PHRASE_BG : CLASS_PHRASE_EN)[c];
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed FACTS for the three call types — see spec §3.
// ─────────────────────────────────────────────────────────────────────────────

interface ExplainMoveInput {
  fen: string;
  player: 'White' | 'Black';
  played_san: string;
  best_san: string | null;
  classification: Classification;
  cp_loss: number;
  pv_san?: string[];
  history?: string[];
  user_perspective?: boolean;
}

function parseMoveDetail(san: string, fenBefore: string, language: Language, audience: Audience) {
  try {
    const c = new Chess(fenBefore);
    const m = c.move(san, { strict: false });
    if (!m) return { natural: san, is_capture: false, captured_piece: null as string | null, is_check: san.endsWith('+'), is_castle: false as false | 'short' | 'long', is_promotion: null as string | null, from_sq: '', to_sq: '' };
    const flags = m.flags ?? '';
    const isCastle: 'short' | 'long' | false = flags.includes('k') ? 'short' : flags.includes('q') ? 'long' : false;
    const names = pieceNames(language, audience);
    const captured = m.captured ? (names[m.captured.toUpperCase()] ?? null) : null;
    const promotion = m.promotion ? (names[m.promotion.toUpperCase()] ?? null) : null;
    return {
      natural: sanToNatural(san, fenBefore, language, audience),
      is_capture: Boolean(m.captured),
      captured_piece: captured,
      is_check: san.endsWith('+') || san.endsWith('#'),
      is_castle: isCastle,
      is_promotion: promotion,
      from_sq: m.from,
      to_sq: m.to,
    };
  } catch {
    return { natural: san, is_capture: false, captured_piece: null, is_check: false, is_castle: false as false, is_promotion: null, from_sq: '', to_sq: '' };
  }
}

/** FACTS payload for /api/coach/explain. */
export function factsForExplain(input: ExplainMoveInput, language: Language, audience: Audience) {
  const played = parseMoveDetail(input.played_san, input.fen, language, audience);
  const bestSameAsPlayed = !input.best_san || input.best_san === input.played_san;
  const best = bestSameAsPlayed
    ? { natural: null, is_same_as_played: true }
    : { natural: sanToNatural(input.best_san!, input.fen, language, audience), is_same_as_played: false };
  const pvNatural = bestSameAsPlayed ? [] : pvToNaturalSan(input.pv_san ?? [], input.fen, language, audience, 4);

  // Material balance after the played move (white perspective, in pawn units).
  let materialDiff = 0;
  try {
    const c = new Chess(input.fen);
    c.move(input.played_san, { strict: false });
    const board = c.fen().split(' ')[0] ?? '';
    for (const ch of board) {
      if (ch === '/' || /\d/.test(ch)) continue;
      const v = PIECE_VALUE[ch.toUpperCase()] ?? 0;
      if (ch === ch.toUpperCase()) materialDiff += v;
      else materialDiff -= v;
    }
  } catch { /* leave 0 */ }

  return {
    lang: language,
    audience,
    perspective: input.user_perspective ? (language === 'bg' ? 'ти' : 'you') : input.player,
    side_to_move_before: input.player.toLowerCase(),
    history_recent: recentMovesNatural(input.history ?? [], language, audience, 5),
    played,
    best,
    engine_pv: pvNatural,
    classification: input.classification,
    cp_loss: input.cp_loss,
    material_diff_after_white: materialDiff,
    verdict: verdictPhrase(input.classification, language),
  };
}

/** Build the user-message body for /api/coach/explain. */
export function explainMovePrompt(input: ExplainMoveInput, language: Language, audience: Audience = 'beginner'): string {
  const facts = factsForExplain(input, language, audience);
  const factsJson = JSON.stringify(facts, null, 2);

  if (language === 'bg') {
    const persp = input.user_perspective ? 'ти' : (input.player === 'White' ? 'Бели' : 'Черни');
    return `FACTS:\n${factsJson}\n\nTASK: Обясни хода. Обърни се към играча като "${persp}". Без шахматна нотация. Без JSON. Само естествен език на български.`;
  }
  const persp = input.user_perspective ? 'you' : input.player;
  return `FACTS:\n${factsJson}\n\nTASK: Explain the move. Address the player as "${persp}". No chess notation. No JSON. Natural language only, in English.`;
}

/** Build the user-message body for /api/coach/hint. */
export function hintPrompt(fen: string, audience: Audience, language: Language, history: string[] = []): string {
  const recent = recentMovesNatural(history, language, audience, 5);
  const phaseGuess = history.length < 14 ? 'opening' : history.length < 50 ? 'middlegame' : 'endgame';
  const facts = {
    lang: language,
    audience,
    side_to_move: fen.split(' ')[1] === 'w' ? 'white' : 'black',
    history_recent: recent,
    phase: phaseGuess,
  };
  const factsJson = JSON.stringify(facts, null, 2);
  if (language === 'bg') {
    return `FACTS:\n${factsJson}\n\nTASK: Дай концептуален намек за позицията — НЕ казвай конкретен ход, фигура или продължение. Покажи накъде да гледаме. Без шахматна нотация. 1-2 изречения на български.`;
  }
  return `FACTS:\n${factsJson}\n\nTASK: Give a conceptual hint about the position — do NOT name a specific move, piece, or continuation. Point at the right idea. No chess notation. 1-2 sentences in English.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility helpers retained for legacy callers (coach/review.ts uses
// pieceNatural and recentMovesSan). New code should reach for the typed
// builders above.
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated — use sanToNatural directly. Kept so review.ts keeps compiling
 *  during the migration. */
export function pieceNatural(san: string, fenBefore: string, language: Language = 'en', audience: Audience = 'beginner'): string {
  return sanToNatural(san, fenBefore, language, audience);
}

/** Recent moves in compact natural language joined with commas. Kept for
 *  callers that want a single string rather than an array. */
export function recentMovesSan(history: string[], maxPlies = 8): string {
  if (!history.length) return '—';
  return recentMovesNatural(history, 'en', 'beginner', maxPlies).join('; ');
}

/** @deprecated — board ASCII is no longer emitted to the LLM (spec §9.6).
 *  Retained so any debug caller compiles. */
export function fenToContext(fen: string, _language: Language = 'en', _audience: Audience = 'beginner'): string {
  return `(FEN: ${fen})`;
}
