import { Chess } from "chess.js";
import { cpToWinPct } from "../chess/classifier.js";
import type { Audience, Language, Classification } from "../types.js";

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

const PIECE_NAME_EN: Record<string, string> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight",
  P: "pawn",
};
const PIECE_NAME_BG: Record<string, string> = {
  K: "цар",
  Q: "дама",
  R: "топ",
  B: "офицер",
  N: "кон",
  P: "пешка",
};
const PIECE_NAME_ES: Record<string, string> = {
  K: "rey",
  Q: "dama",
  R: "torre",
  B: "alfil",
  N: "caballo",
  P: "peón",
};
const PIECE_NAME_KID_EN: Record<string, string> = {
  K: "king",
  Q: "queen",
  R: "castle",
  B: "bishop",
  N: "horsey",
  P: "pawn",
};
const PIECE_NAME_KID_BG: Record<string, string> = {
  K: "цар",
  Q: "дама",
  R: "топче",
  B: "офицер",
  N: "конче",
  P: "пешка",
};
const PIECE_NAME_KID_ES: Record<string, string> = {
  K: "rey",
  Q: "reina",
  R: "castillo",
  B: "alfil",
  N: "caballito",
  P: "peón",
};
const PIECE_VALUE: Record<string, number> = {
  K: 0,
  Q: 9,
  R: 5,
  B: 3,
  N: 3,
  P: 1,
};

const PIECE_NAMES: Record<"kid" | "standard", Record<Language, Record<string, string>>> = {
  kid: {
    en: PIECE_NAME_KID_EN,
    bg: PIECE_NAME_KID_BG,
    es: PIECE_NAME_KID_ES,
  },
  standard: {
    en: PIECE_NAME_EN,
    bg: PIECE_NAME_BG,
    es: PIECE_NAME_ES,
  },
};

export function pieceNames(
  language: Language,
  audience: Audience,
): Record<string, string> {
  const mode = audience === "kid" ? "kid" : "standard";
  return PIECE_NAMES[mode][language] ?? PIECE_NAMES[mode].en;
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
    sentences: "2 short sentences, 6-12 words each.",
    allowed:
      'simple words; piece names; "looks", "watching", "safe", "attack", "defend"',
    banned:
      "blunder, evaluation, prophylaxis, outpost, tempo, initiative, pin, skewer, discovered attack, weak square",
  },
  beginner: {
    tone: "Friendly, instructional, principle-first. Name ONE concept per moment (king safety, development, counting attackers/defenders).",
    sentences: "3 short sentences, 10-18 words each.",
    allowed:
      "king safety, development, center, capture, attack, defend, threat, piece value",
    banned:
      "prophylaxis, outpost, minority attack, restraint, zugzwang, fortress, undermining",
  },
  intermediate: {
    tone: "Concrete sport-commentary. Name standard tactical and positional motifs by name.",
    sentences: "3-5 sentences, 14-22 words each.",
    allowed:
      "pin, fork, skewer, discovered attack, deflection, overload, weak square, outpost, open file, pawn structure, king safety, piece activity, tempo, initiative",
    banned:
      "prophylaxis, minority attack, zugzwang, fortress, restraint, undermining",
  },
  advanced: {
    tone: "Peer-to-peer, fast, motif-dense. Plan and key squares matter more than basics.",
    sentences: "3-6 sentences, 16-26 words each.",
    allowed:
      "prophylaxis, minority attack, restraint, undermining, breakthrough, fortress, zugzwang, opposition, triangulation, plus all intermediate vocabulary",
    banned: "(no banned list at this tier — write peer-to-peer)",
  },
};

const AUDIENCE_BG: Record<Audience, AudienceBlock> = {
  kid: {
    tone: 'Мил, нежен, насърчителен. Грешките са "опс", не "грешки". Фигурите са герои: конят е кончето, топът е топчето.',
    sentences: "2 кратки изречения, 6-12 думи всяко.",
    allowed:
      'прости думи; имена на фигури; "гледа", "пази", "атакува", "защитава"',
    banned:
      "блъндер, оценка, профилактика, аванпост, темпо, инициатива, пирон, шиш, скрит удар, слабо поле",
  },
  beginner: {
    tone: "Приятелски, обучаващ, принципно ориентиран. Назовавай ЕДИН принцип на момент (безопасност на царя, развитие, атакуващи и защитници).",
    sentences: "3 кратки изречения, 10-18 думи всяко.",
    allowed:
      "безопасност на царя, развитие, център, взимане, атака, защита, заплаха, стойност на фигура",
    banned:
      "профилактика, аванпост, малцинствена атака, ограничение, цугцванг, крепост, подкопаване",
  },
  intermediate: {
    tone: "Конкретен спортен коментар. Назовавай стандартни тактически и позиционни мотиви.",
    sentences: "3-5 изречения, 14-22 думи всяко.",
    allowed:
      "пирон, вилица, шиш, скрит удар, отклонение, претоварване, слабо поле, аванпост, отворена линия, пешечна структура, безопасност на царя, активност на фигурите, темпо, инициатива",
    banned:
      "профилактика, малцинствена атака, цугцванг, крепост, ограничение, подкопаване",
  },
  advanced: {
    tone: "Колега до колега, бързо, мотиви плътно. Планът и ключовите полета имат значение повече от основите.",
    sentences: "3-6 изречения, 16-26 думи всяко.",
    allowed:
      "профилактика, малцинствена атака, ограничение, подкопаване, пробив, крепост, цугцванг, опозиция, триангулация и цялата средна лексика",
    banned: "(няма забранен списък на това ниво — пиши колега до колега)",
  },
};
const AUDIENCE_ES: Record<Audience, AudienceBlock> = {
  kid: {
    tone: 'Cálido, amigable, alentador. Los errores son "ups", no "fallos". Las piezas son personajes: el caballo es un caballito, la torre es un castillo.',
    sentences: "2 frases cortas, de 6 a 12 palabras cada una.",
    allowed:
      'palabras sencillas; nombres de piezas; "mira", "observa", "seguro", "ataque", "defensa"',
    banned:
      "error grave, evaluación, profilaxis, casilla fuerte, tiempo, iniciativa, clavada, enfilada, ataque a la descubierta, casilla débil",
  },
  beginner: {
    tone: "Amigable, instructivo, centrado en principios básicos. Nombra UN solo concepto por momento (seguridad del rey, desarrollo, contar atacantes/defensores).",
    sentences: "3 frases cortas, de 10 a 18 palabras cada una.",
    allowed:
      "seguridad del rey, desarrollo, centro, captura, ataque, defensa, amenaza, valor de las piezas",
    banned:
      "profilaxis, casilla fuerte, ataque de minorías, restricción, zugzwang, fortaleza, subversión",
  },
  intermediate: {
    tone: "Comentario deportivo concreto. Nombra los motivos tácticos y posicionales estándar por su nombre.",
    sentences: "3 a 5 frases, de 14 a 22 palabras cada una.",
    allowed:
      "clavada, doblete, enfilada, ataque a la descubierta, desviación, sobrecarga, casilla débil, casilla fuerte, columna abierta, estructura de peones, seguridad del rey, actividad de piezas, tiempo, iniciativa",
    banned:
      "profilaxis, ataque de minorías, zugzwang, fortaleza, restricción, subversión",
  },
  advanced: {
    tone: "De igual a igual, fluido, denso en conceptos. Los planes y las casillas clave importan más que los conceptos básicos.",
    sentences: "3 a 6 frases, de 16 a 26 palabras cada una.",
    allowed:
      "profilaxis, ataque de minorías, restricción, subversión, ruptura, fortaleza, zugzwang, oposición, triangulación, más todo el vocabulario intermedio",
    banned:
      "(sin lista de prohibiciones en este nivel — escribe de igual a igual)",
  },
};

const AUDIENCE_DATA: Record<Language, Record<Audience, AudienceBlock>> = {
  en: AUDIENCE_EN,
  bg: AUDIENCE_BG,
  es: AUDIENCE_ES,
};

const AUDIENCE_LABELS: Record<
  Language,
  (a: Audience, b: AudienceBlock) => string
> = {
  en: (a, b) =>
    `Audience: ${a}.\nTONE: ${b.tone}\nLENGTH: ${b.sentences}\nALLOWED CONCEPTS: ${b.allowed}.\nBANNED CONCEPTS: ${b.banned}.`,
  bg: (a, b) =>
    `Аудитория: ${a}.\nТОН: ${b.tone}\nДЪЛЖИНА: ${b.sentences}\nРАЗРЕШЕНИ ПОНЯТИЯ: ${b.allowed}.\nЗАБРАНЕНИ ПОНЯТИЯ: ${b.banned}.`,
  es: (a, b) =>
    `Audiencia: ${a}.\nTONO: ${b.tone}\nLONGITUD: ${b.sentences}\nCONCEPTOS PERMITIDOS: ${b.allowed}.\nCONCEPTOS PROHIBIDOS: ${b.banned}.`,
};

function audienceBlock(audience: Audience, language: Language): string {
  const lang = AUDIENCE_DATA[language] ? language : "en";
  const b = AUDIENCE_DATA[lang][audience];
  return AUDIENCE_LABELS[lang](audience, b);
}

const PERSONA_EN = `=== PERSONA ===
You are Patzer's chess coach. Your voice is Chess.com's Game Review narrator: warm, friendly, sport-commentary energy, never condescending, always concrete. You speak directly to the player as "you".`;

const PERSONA_BG = `=== ПЕРСОНА ===
Ти си шах треньорът на Patzer. Гласът ти е този на разказвача в Game Review на Chess.com: топъл, приятелски, спортно-коментарна енергия, никога снизходителен, винаги конкретен. Говориш директно на играча с "ти".`;
const PERSONA_ES = `=== PERSONA ===
Eres el entrenador de ajedrez de Patzer. Tu voz es la del narrador del Análisis de Partida de Chess.com: cálida, amigable, con energía de comentario deportivo, nunca condescendiente y siempre concreta. Te diriges directamente al jugador de "tú".`;

const HARD_RULES_EN = `=== HARD RULES ===
You are a RENDERER, not an analyst. The user message contains a JSON object named FACTS that has already been computed by Stockfish + chess.js. Your only job is to phrase those facts in the persona above.

R1. Use only what is in FACTS. Never name a piece, square, capture, threat, move, or continuation that is not in FACTS. If FACTS does not include it, it does not exist. The exact pieces still on the board appear in FACTS.your_pieces and FACTS.opponent_pieces when present — do NOT reference any piece or square outside those lists.
R2. Never write chess notation (Nf3, Bxh7, O-O, Qd2+). Use natural language only. Squares (h7, e4) on their own are fine.
R3. Never invent continuations past FACTS.engine_pv. If engine_pv has N entries, describe at most N follow-up moves.
R4. Never claim winning / losing / mating unless FACTS.evaluation_state or FACTS.verdict says so. Use FACTS.evaluation_state ("winning", "slightly worse", etc.) and FACTS.material_balance verbatim when describing the position.
R5. Output language: English. Every word in English. Translate piece names (queen, knight, etc.).
R6. Length cap: see the audience block. No bullet lists, no headings, no markdown unless TASK asks for JSON.
R7. Begin directly with the explanation. No "Sure!", "Of course!", "Let me explain", "Here's what happened", or repeating the question.
R8. One praise phrase per response, maximum ("nicely done", "great find", "well played"). Never praise a mistake, blunder, or inaccuracy.
R9. Use only ALLOWED CONCEPTS from the audience block. Never use a BANNED CONCEPT.
R10. Don't say "in this position" / "as we can see" / "let's dive in" / "overall" / "in conclusion" — those are AI tells. Sound like a sportscaster, not a textbook.
R11. If FACTS doesn't tell you a specific piece, square, or motif, STAY GENERAL. Talk about the verdict, the win-percentage swing, or the material balance — never invent details to fill space. A short faithful sentence beats a long invented one.

EXAMPLE — GOOD (faithful to FACTS): "Solid development. The bishop comes out and your win chances tick up a couple of points — nothing flashy, just clean play."
EXAMPLE — BAD (invented details NOT in FACTS): "Your bishop on c4 pins the knight on f6 against the queen on d8, threatening to win material after Nxe5." (Notation. Specific pieces and squares the FACTS never mentioned. Invented threats.)`;

const HARD_RULES_BG = `=== ТВЪРДИ ПРАВИЛА ===
Ти си РЕНДЕРЕР, не анализатор. В съобщението има JSON обект FACTS, който вече е изчислен от Stockfish + chess.js. Единствената ти задача е да преведеш фактите в гласа на персоната по-горе.

R1. Използвай само това, което е във FACTS. Не споменавай фигура, поле, взимане, заплаха, ход или продължение, което не е във FACTS. Точните фигури на дъската са в FACTS.your_pieces и FACTS.opponent_pieces, когато присъстват — НЕ споменавай фигура или поле извън тези списъци.
R2. Никога не използвай шахматна нотация (Кf3, Оxh7, 0-0, Дd2+). Само естествен език. Полета (h7, e4) сами по себе си са ок.
R3. Не измисляй продължения извън FACTS.engine_pv. Ако engine_pv има N хода, опиши най-много N последващи хода.
R4. Не казвай "печели" / "губи" / "матиран" освен ако FACTS.evaluation_state или FACTS.verdict го казва. Използвай FACTS.evaluation_state ("печелиш", "малко по-зле") и FACTS.material_balance дословно.
R5. Език на изхода: български. Всяка дума на български. Превеждай имената на фигурите (дама, кон, и т.н.).
R6. Лимит на дължина: виж блока за аудиторията. Без списъци, без заглавия, без markdown освен ако TASK не иска JSON.
R7. Започвай директно с обяснението. Без "Разбира се!", "Нека ти обясня", "Ето какво се случи" или повтаряне на въпроса.
R8. Една похвална фраза на отговор, максимум ("страхотно", "браво", "добре изиграно"). Никога не хвали грешка, блъндер или неточност.
R9. Използвай само РАЗРЕШЕНИ ПОНЯТИЯ от блока за аудиторията. Никога ЗАБРАНЕНО ПОНЯТИЕ.
R10. Не казвай "в тази позиция" / "както виждаме" / "нека започнем" / "като цяло" / "в заключение" — това са AI-маркери. Звучи като спортен коментатор, не като учебник.
R11. Ако FACTS не съдържа конкретна фигура, поле или мотив, ОСТАНИ ОБЩ. Говори за оценката, промяната в шанса за победа или материалното равновесие — никога не измисляй детайли. Кратко вярно изречение е по-добре от дълго измислено.

ПРИМЕР — ДОБРО (вярно на FACTS): "Солидно развитие. Офицерът излиза и шансът ти за победа се покачва с няколко процента — нищо ефектно, чиста игра."
ПРИМЕР — ЛОШО (измислени детайли извън FACTS): "Офицерът ти на c4 пиронира коня на f6 срещу дамата на d8 и заплашва да спечели материал след Кxe5." (Нотация. Конкретни фигури и полета, които FACTS не споменава. Измислени заплахи.)`;
const HARD_RULES_ES = `=== REGLAS STRICTAS ===
Eres un RENDERIZADOR, no un analista. El mensaje del usuario contiene un objeto JSON llamado FACTS que ya ha sido calculado por Stockfish + chess.js. Tu único trabajo es redactar esos hechos con la personalidad descrita anteriormente.

R1. Usa únicamente lo que esté en FACTS. Nunca nombres una pieza, casilla, captura, amenaza, jugada o continuación que no esté en FACTS. Si FACTS no lo incluye, no existe. Las piezas exactas que aún están en el tablero aparecen en FACTS.your_pieces y FACTS.opponent_pieces cuando están presentes; NO hagas referencia a ninguna pieza o casilla fuera de esas listas.
R2. Nunca escribas notación de ajedrez (Nf3, Bxh7, O-O, Qd2+). Usa únicamente lenguaje natural. Las casillas individuales (h7, e4) están bien.
R3. Nunca inventes continuaciones más allá de FACTS.engine_pv. Si engine_pv tiene N entradas, describe como máximo N jugadas posteriores.
R4. Nunca afirmes que se está ganando / perdiendo / dando mate a menos que FACTS.evaluation_state o FACTS.verdict lo digan. Usa FACTS.evaluation_state ("ganando", "ligeramente peor", etc.) y FACTS.material_balance de forma textual al describir la posición.
R5. Idioma de salida: Español. Cada palabra en español. Traduce los nombres de las piezas (reina/dama, caballo, etc.).
R6. Límite de longitud: consulta el bloque de audiencia. Sin listas con viñetas, sin encabezados, sin markdown a menos que TASK pida JSON.
R7. Comienza directamente con la explicación. Nada de "¡Claro!", "¡Por supuesto!", "Déjame explicarte", "Esto es lo que pasó", ni repetir la pregunta.
R8. Máximo una frase de elogio por respuesta ("bien hecho", "gran hallazgo", "bien jugado"). Nunca elogies un error, un fallo grave o una imprecisión.
R9. Usa únicamente los CONCEPTOS PERMITIDOS del bloque de audiencia. Nunca uses un CONCEPTO PROHIBIDO.
R10. No digas "en esta posición" / "como podemos ver" / "vamos a profundizar" / "en general" / "en conclusión"; esas son muletillas de IA. Muestra la energía de un comentarista deportivo, no la de un libro de texto.
R11. Si FACTS no te da una pieza, casilla o motivo específico, MANTENTE GENERAL. Habla sobre el veredicto, la variación en la probabilidad de victoria o el balance de material; nunca inventes detalles para rellenar espacio. Una frase corta y fiel es mejor que una larga e inventada.

EJEMPLO — BUENO (fiel a FACTS): "Desarrollo sólido. El alfil sale y tus probabilidades de victoria suben un par de puntos; nada ostentoso, simplemente un juego limpio."
EJEMPLO — MALO (detalles inventados NO presentes en FACTS): "Tu alfil en c4 clava al caballo en f6 contra la dama en d8, amenazando con ganar material tras Nxe5." (Uso de notación. Piezas y casillas específicas que FACTS nunca mencionó. Amenazas inventadas.)`;

const PERSONA: Record<Language, string> = {
  en: PERSONA_EN,
  bg: PERSONA_BG,
  es: PERSONA_ES,
};
const HARD_RULES: Record<Language, string> = {
  en: HARD_RULES_EN,
  bg: HARD_RULES_BG,
  es: HARD_RULES_ES,
};
export function systemPrompt(audience: Audience, language: Language): string {
  const lang = PERSONA[language] ? language : "en";
  return `${PERSONA[lang]}\n\n${audienceBlock(audience, language)}\n\n${HARD_RULES[lang]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Natural-language move rendering — converts a SAN move (in a given position)
// into "the knight takes on f7" prose. Language- AND audience-aware so a
// Bulgarian kid review gets "кончето на f7" while an English advanced review
// gets "the knight to f7". Used to build FACTS payloads — the LLM never sees
// SAN directly.
// ─────────────────────────────────────────────────────────────────────────────

const CASTLE_SHORT: Record<Language, string> = {
  en: "short castles",
  bg: "къса рокада",
  es: "enroque corto",
};

const CASTLE_LONG: Record<Language, string> = {
  en: "long castles",
  bg: "дълга рокада",
  es: "enroque largo",
};

type MoveFormatParams = {
  pieceName: string;
  captured?: string | null;
  from: string;
  to: string;
  promo: string | null;
  isCheck?: boolean;
  isMate?: boolean;
};

const MOVE_DESCRIPTIONS: Record<
  Language,
  {
    capture: (p: MoveFormatParams) => string;
    pawn: (p: MoveFormatParams) => string;
    default: (p: MoveFormatParams) => string;
    suffix: (p: MoveFormatParams) => string;
  }
> = {
  en: {
    capture: ({ pieceName, captured, to }) =>
      `the ${pieceName} takes the ${captured} on ${to}`,
    pawn: ({ pieceName, to }) => `the ${pieceName} to ${to}`,
    default: ({ pieceName, from, to }) =>
      `the ${pieceName} from ${from} to ${to}`,
    suffix: ({ promo, isCheck, isMate }) => {
      let extra = "";
      if (promo) extra += `, promoting to a ${promo}`;
      if (isMate) extra += " (checkmate)";
      else if (isCheck) extra += " (check)";
      return extra;
    },
  },
  bg: {
    capture: ({ pieceName, captured, to }) =>
      `${pieceName} взема ${captured} на ${to}`,
    pawn: ({ pieceName, to }) => `${pieceName} на ${to}`,
    default: ({ pieceName, from, to }) => `${pieceName} от ${from} на ${to}`,
    suffix: ({ promo, isCheck, isMate }) => {
      let extra = "";
      if (promo) extra += `, повишена в ${promo}`;
      if (isMate) extra += " (мат)";
      else if (isCheck) extra += " (шах)";
      return extra;
    },
  },
  es: {
    capture: ({ pieceName, captured, to }) =>
      `${pieceName} captura a ${captured} en ${to}`,
    pawn: ({ pieceName, to }) => `${pieceName} a ${to}`,
    default: ({ pieceName, from, to }) => `${pieceName} de ${from} a ${to}`,
    suffix: ({ promo, isCheck, isMate }) => {
      let extra = "";
      if (promo) extra += `, promociona a ${promo}`;
      if (isMate) extra += " (jaque mate)";
      else if (isCheck) extra += " (jaque)";
      return extra;
    },
  },
};

export function sanToNatural(
  san: string,
  fenBefore: string,
  language: Language,
  audience: Audience,
): string {
  const names = pieceNames(language, audience);
  let res: ReturnType<Chess["move"]> | null = null;
  try {
    const c = new Chess(fenBefore);
    res = c.move(san, { strict: false });
  } catch {
    /* fall through */
  }
  if (!res) return san; // can't parse — fall back to SAN

  const flags = res.flags ?? "";
  if (flags.includes("k")) {
    return CASTLE_SHORT[language] ?? CASTLE_SHORT.en;
  }
  if (flags.includes("q")) {
    return CASTLE_LONG[language] ?? CASTLE_LONG.en;
  }
  const piece = (res.piece || "p").toUpperCase();
  const pieceName = names[piece] ?? names.P!;
  const captured = res.captured ? names[res.captured.toUpperCase()] : null;
  const isCheck = san.endsWith("+");
  const isMate = san.endsWith("#");
  const promo = res.promotion ? names[res.promotion.toUpperCase()] : null;

  let core: string;
  const fmt = MOVE_DESCRIPTIONS[language] ?? MOVE_DESCRIPTIONS.en;
  const params: MoveFormatParams = {
    pieceName,
    captured,
    from: res.from,
    to: res.to,
    promo,
    isCheck,
    isMate,
  };

  if (captured) {
    core = fmt.capture(params);
  } else if (piece === "P") {
    core = fmt.pawn(params);
  } else {
    core = fmt.default(params);
  }

  core += fmt.suffix(params);

  return core;
}

/** Replay a PV (UCI or SAN) through chess.js and render each move into the
 *  requested language. Max-length capped so prompts stay tight on small models. */
export function pvToNaturalSan(
  pvSan: string[],
  fromFen: string,
  language: Language,
  audience: Audience,
  max = 4,
): string[] {
  if (!pvSan.length) return [];
  const replay = new Chess(fromFen);
  const out: string[] = [];
  for (const s of pvSan.slice(0, max)) {
    const before = replay.fen();
    const phrase = sanToNatural(s, before, language, audience);
    try {
      replay.move(s, { strict: false });
    } catch {
      break;
    }
    out.push(phrase);
  }
  return out;
}

/** Convert the last N plies of a SAN history into natural-language phrases for
 *  the FACTS.history_recent field. The LLM never sees SAN this way. */
export function recentMovesNatural(
  history: string[],
  language: Language,
  audience: Audience,
  maxPlies = 5,
): string[] {
  if (!history.length) return [];
  const start = Math.max(0, history.length - maxPlies);
  const replay = new Chess();
  // Replay from start up to `start` to catch up the position, then start emitting
  // natural-language renderings.
  for (let i = 0; i < start; i++) {
    try {
      replay.move(history[i]!, { strict: false });
    } catch {
      /* fall through */
    }
  }
  const out: string[] = [];
  for (let i = start; i < history.length; i++) {
    const before = replay.fen();
    const phrase = sanToNatural(history[i]!, before, language, audience);
    try {
      replay.move(history[i]!, { strict: false });
    } catch {
      break;
    }
    out.push(phrase);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdict phrasing (used by FACTS.verdict — the LLM may quote verbatim)
// ─────────────────────────────────────────────────────────────────────────────

const CLASS_PHRASE_EN: Record<Classification, string> = {
  brilliant: "a brilliant move — the engine's top pick AND a real sacrifice",
  great: "a great move — the only move that held the position",
  best: "the engine's top choice",
  excellent: "an excellent move",
  good: "a solid move",
  book: "a known opening / theory move",
  forced: "a forced move — the only legal option",
  inaccuracy: "a small inaccuracy",
  mistake: "a mistake — a meaningfully better move was on the board",
  blunder: "a blunder — significant material or position lost",
  miss: "a missed win — a much stronger move was available",
};
const CLASS_PHRASE_BG: Record<Classification, string> = {
  brilliant: "брилянтен ход — топ изборът на двигателя И истинска жертва",
  great: "страхотен ход — единственият, който държеше позицията",
  best: "топ изборът на двигателя",
  excellent: "отличен ход",
  good: "солиден ход",
  book: "теоретичен ход",
  forced: "принуден ход — единственият легален",
  inaccuracy: "малка неточност",
  mistake: "грешка — имаше осезаемо по-добър ход",
  blunder: "блъндер — губи значително",
  miss: "пропуснат шанс — имаше много по-силен ход",
};
const CLASS_PHRASE_ES: Record<Classification, string> = {
  brilliant:
    "una jugada brillante: la mejor opción del motor Y un sacrificio real",
  great: "una gran jugada: la única que mantenía la posición",
  best: "la mejor opción del motor",
  excellent: "una jugada excelente",
  good: "una jugada sólida",
  book: "una jugada de apertura conocida / teórica",
  forced: "una jugada forzada: la única opción legal",
  inaccuracy: "una pequeña imprecisión",
  mistake: "un error: había una jugada claramente mejor en el tablero",
  blunder:
    "un error grave: se perdió material o posición de forma significativa",
  miss: "una oportunidad perdida: había una jugada mucho más fuerte disponible",
};

const CLASS_PHRASES: Record<Language, Record<Classification, string>> = {
  en: CLASS_PHRASE_EN,
  bg: CLASS_PHRASE_BG,
  es: CLASS_PHRASE_ES,
};

export function verdictPhrase(c: Classification, language: Language): string {
  const lang = CLASS_PHRASES[language] ? language : "en";
  return CLASS_PHRASES[lang][c];
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed FACTS for the three call types — see spec §3.
// ─────────────────────────────────────────────────────────────────────────────

interface ExplainMoveInput {
  fen: string;
  player: "White" | "Black";
  played_san: string;
  best_san: string | null;
  classification: Classification;
  cp_loss: number;
  /** Optional engine evaluation (cp, white-perspective) before/after the move.
   *  When provided, the FACTS payload gains win-probability and a natural-
   *  language `evaluation_state` field — strong grounding for small models. */
  eval_before_cp?: number | null;
  eval_after_cp?: number | null;
  pv_san?: string[];
  history?: string[];
  user_perspective?: boolean;
}

/** Natural-language label for a win-percentage value, from the player's
 *  perspective. Gives small models a concrete word to anchor on instead of
 *  reaching for trained chess prose. */
type EvalStateKey =
  | "winning"
  | "clearly_better"
  | "slightly_better"
  | "equal"
  | "slightly_worse"
  | "clearly_worse"
  | "losing";

function getEvalStateKey(winPctPlayer: number): EvalStateKey {
  if (winPctPlayer >= 90) return "winning";
  if (winPctPlayer >= 70) return "clearly_better";
  if (winPctPlayer >= 58) return "slightly_better";
  if (winPctPlayer >= 42) return "equal";
  if (winPctPlayer >= 30) return "slightly_worse";
  if (winPctPlayer >= 10) return "clearly_worse";
  return "losing";
}

function evaluationStateNatural(
  winPctPlayer: number,
  language: Language,
): string {
  const key = getEvalStateKey(winPctPlayer);

  switch (language) {
    case "bg":
      switch (key) {
        case "winning":
          return "спечелено";
        case "clearly_better":
          return "значително по-добре";
        case "slightly_better":
          return "малко по-добре";
        case "equal":
          return "равно";
        case "slightly_worse":
          return "малко по-зле";
        case "clearly_worse":
          return "значително по-зле";
        case "losing":
          return "загубено";
      }

    case "es":
      switch (key) {
        case "winning":
          return "ganando";
        case "clearly_better":
          return "claramente mejor";
        case "slightly_better":
          return "ligeramente mejor";
        case "equal":
          return "igualado";
        case "slightly_worse":
          return "ligeramente peor";
        case "clearly_worse":
          return "claramente peor";
        case "losing":
          return "perdiendo";
      }

    case "en":
    default:
      switch (key) {
        case "winning":
          return "winning";
        case "clearly_better":
          return "clearly better";
        case "slightly_better":
          return "slightly better";
        case "equal":
          return "roughly equal";
        case "slightly_worse":
          return "slightly worse";
        case "clearly_worse":
          return "clearly worse";
        case "losing":
          return "losing";
      }
  }
}

/** Walk the board and return natural-language piece inventories for each
 *  side. Without this, small models hallucinate piece locations from training
 *  data (e.g. "your bishop on c4 pins the knight" — when there's no bishop
 *  on c4). With it, the model has the exact piece list to anchor on.
 *  Returns one entry per non-pawn piece (e.g. "queen on d8"), plus a single
 *  pawn-count line per side. */
export function boardPiecesNatural(
  fen: string,
  playerColor: "white" | "black",
  language: Language,
  audience: Audience,
): { player: string[]; opponent: string[] } {
  const names = pieceNames(language, audience);
  const board = fen.split(" ")[0] ?? "";
  const ranks = board.split("/");
  const player = { non_pawn: [] as string[], pawns: 0 };
  const opponent = { non_pawn: [] as string[], pawns: 0 };
  for (let r = 0; r < ranks.length; r++) {
    let file = 0;
    for (const ch of ranks[r]!) {
      if (/\d/.test(ch)) {
        file += parseInt(ch, 10);
        continue;
      }
      const isWhitePiece = ch === ch.toUpperCase();
      const pieceColor = isWhitePiece ? "white" : "black";
      const sq = String.fromCharCode(97 + file) + (8 - r);
      const symbol = ch.toUpperCase();
      const bucket = pieceColor === playerColor ? player : opponent;
      if (symbol === "P") {
        bucket.pawns++;
      } else {
        const pieceName = names[symbol] ?? symbol;
        let location: string;
        switch (language) {
          case "bg":
            location = `${pieceName} на ${sq}`;
            break;
          case "es":
            location = `${pieceName} en ${sq}`;
            break;
          default:
            location = `${pieceName} on ${sq}`;
        }
        bucket.non_pawn.push(location);
      }
      file++;
    }
  }
  const pawnLine = (n: number) => {
    if (n === 0) return null;
    switch (language) {
      case "bg":
        return `${n} ${names.P!}и`;
      case "es":
        return n === 1 ? `${n} ${names.P}` : `${n} peones`;
      case "en":
      default:
        return `${n} ${names.P}${n === 1 ? "" : "s"}`;
    }
  };
  return {
    player: [
      ...player.non_pawn,
      ...(pawnLine(player.pawns) ? [pawnLine(player.pawns)!] : []),
    ],
    opponent: [
      ...opponent.non_pawn,
      ...(pawnLine(opponent.pawns) ? [pawnLine(opponent.pawns)!] : []),
    ],
  };
}

/** Natural-language description of material balance from the player's
 *  perspective. `diffPlayer` is in pawn units (positive = player ahead). */
function materialBalanceNatural(
  diffPlayer: number,
  language: Language,
  audience: Audience,
): string {
  const names = pieceNames(language, audience);
  const abs = Math.abs(diffPlayer);
  const ahead = diffPlayer > 0;

  if (abs < 1) {
    if (language === "bg") return "материалът е равен";
    if (language === "es") return "el material está igualado";
    return "material is equal";
  }

  let pieceLabel: string;
  if (abs >= 8) pieceLabel = names.Q!;
  else if (abs >= 4.5) pieceLabel = names.R!;
  else if (abs >= 2.5) pieceLabel = names.N!;
  else {
    if (abs >= 1.5) {
      if (language === "bg") pieceLabel = `${abs.toFixed(0)} ${names.P!}а`;
      else if (language === "es") pieceLabel = `${abs.toFixed(0)} peones`;
      else pieceLabel = `${abs.toFixed(0)} ${names.P}s`;
    } else {
      pieceLabel = names.P!;
    }
  }

  if (language === "bg") {
    return ahead ? `имаш ${pieceLabel} повече` : `имаш ${pieceLabel} по-малко`;
  }
  if (language === "es") {
    return ahead
      ? `tienes ${pieceLabel} de ventaja`
      : `tienes ${pieceLabel} de menos`;
  }
  return ahead ? `you are up a ${pieceLabel}` : `you are down a ${pieceLabel}`;
}

function parseMoveDetail(
  san: string,
  fenBefore: string,
  language: Language,
  audience: Audience,
) {
  try {
    const c = new Chess(fenBefore);
    const m = c.move(san, { strict: false });
    if (!m)
      return {
        natural: san,
        is_capture: false,
        captured_piece: null as string | null,
        is_check: san.endsWith("+"),
        is_castle: false as false | "short" | "long",
        is_promotion: null as string | null,
        from_sq: "",
        to_sq: "",
      };
    const flags = m.flags ?? "";
    const isCastle: "short" | "long" | false = flags.includes("k")
      ? "short"
      : flags.includes("q")
        ? "long"
        : false;
    const names = pieceNames(language, audience);
    const captured = m.captured
      ? (names[m.captured.toUpperCase()] ?? null)
      : null;
    const promotion = m.promotion
      ? (names[m.promotion.toUpperCase()] ?? null)
      : null;
    return {
      natural: sanToNatural(san, fenBefore, language, audience),
      is_capture: Boolean(m.captured),
      captured_piece: captured,
      is_check: san.endsWith("+") || san.endsWith("#"),
      is_castle: isCastle,
      is_promotion: promotion,
      from_sq: m.from,
      to_sq: m.to,
    };
  } catch {
    return {
      natural: san,
      is_capture: false,
      captured_piece: null,
      is_check: false,
      is_castle: false as false,
      is_promotion: null,
      from_sq: "",
      to_sq: "",
    };
  }
}
const SECOND_PERSON_PERSPECTIVE: Record<Language, string> = {
  en: "you",
  bg: "ти",
  es: "tú",
};
/** FACTS payload for /api/coach/explain. */
export function factsForExplain(
  input: ExplainMoveInput,
  language: Language,
  audience: Audience,
) {
  const played = parseMoveDetail(
    input.played_san,
    input.fen,
    language,
    audience,
  );
  const bestSameAsPlayed =
    !input.best_san || input.best_san === input.played_san;
  const best = bestSameAsPlayed
    ? { natural: null, is_same_as_played: true }
    : {
        natural: sanToNatural(input.best_san!, input.fen, language, audience),
        is_same_as_played: false,
      };
  const pvNatural = bestSameAsPlayed
    ? []
    : pvToNaturalSan(input.pv_san ?? [], input.fen, language, audience, 4);

  // Material balance + full piece inventory AFTER the played move.
  // The piece inventory is the critical anti-hallucination context: without
  // it, the model invents bishops, knights, and pinned pieces from training
  // data instead of describing the position actually on the board.
  let materialDiffWhite = 0;
  let fenAfter = input.fen;
  try {
    const c = new Chess(input.fen);
    c.move(input.played_san, { strict: false });
    fenAfter = c.fen();
    const board = fenAfter.split(" ")[0] ?? "";
    for (const ch of board) {
      if (ch === "/" || /\d/.test(ch)) continue;
      const v = PIECE_VALUE[ch.toUpperCase()] ?? 0;
      if (ch === ch.toUpperCase()) materialDiffWhite += v;
      else materialDiffWhite -= v;
    }
  } catch {
    /* leave 0 */
  }

  const isWhite = input.player === "White";
  const materialDiffPlayer = isWhite ? materialDiffWhite : -materialDiffWhite;

  // Win-probability anchoring. Without this, small models reach for trained
  // prose ("you have a winning attack") when FACTS only has a centipawn number.
  // With it, the model has a concrete natural-language label to repeat.
  const wpBeforeWhite =
    input.eval_before_cp != null ? cpToWinPct(input.eval_before_cp) : null;
  const wpAfterWhite =
    input.eval_after_cp != null ? cpToWinPct(input.eval_after_cp) : null;
  const wpBeforePlayer =
    wpBeforeWhite != null
      ? isWhite
        ? wpBeforeWhite
        : 100 - wpBeforeWhite
      : null;
  const wpAfterPlayer =
    wpAfterWhite != null ? (isWhite ? wpAfterWhite : 100 - wpAfterWhite) : null;
  const wpDeltaPlayer =
    wpBeforePlayer != null && wpAfterPlayer != null
      ? Math.round(wpAfterPlayer - wpBeforePlayer)
      : null;

  const evaluation =
    wpAfterPlayer != null
      ? {
          win_pct_before: Math.round(wpBeforePlayer!),
          win_pct_after: Math.round(wpAfterPlayer),
          win_pct_delta: wpDeltaPlayer,
          state: evaluationStateNatural(wpAfterPlayer, language),
        }
      : null;

  const playerColor: "white" | "black" = isWhite ? "white" : "black";
  const board = boardPiecesNatural(fenAfter, playerColor, language, audience);
  return {
    lang: language,
    audience,
    perspective: input.user_perspective
      ? (SECOND_PERSON_PERSPECTIVE[language] ?? SECOND_PERSON_PERSPECTIVE.en)
      : input.player,
    side_to_move_before: input.player.toLowerCase(),
    history_recent: recentMovesNatural(
      input.history ?? [],
      language,
      audience,
      5,
    ),
    played,
    best,
    engine_pv: pvNatural,
    classification: input.classification,
    cp_loss: input.cp_loss,
    evaluation_state: evaluation?.state ?? null,
    win_pct_before: evaluation?.win_pct_before ?? null,
    win_pct_after: evaluation?.win_pct_after ?? null,
    win_pct_delta: evaluation?.win_pct_delta ?? null,
    material_balance: materialBalanceNatural(
      materialDiffPlayer,
      language,
      audience,
    ),
    // Full piece inventory of the position AFTER the move. The model must
    // only reference pieces that appear here (R1) — this is what stops
    // hallucinated "your bishop on c4" prose.
    your_pieces: board.player,
    opponent_pieces: board.opponent,
    verdict: verdictPhrase(input.classification, language),
  };
}

/** Build the user-message body for /api/coach/explain. */
export function explainMovePrompt(
  input: ExplainMoveInput,
  language: Language,
  audience: Audience = "beginner",
): string {
  const facts = factsForExplain(input, language, audience);
  const factsJson = JSON.stringify(facts, null, 2);

  if (language === "bg") {
    const persp = input.user_perspective
      ? "ти"
      : input.player === "White"
        ? "Бели"
        : "Черни";
    return `FACTS:\n${factsJson}\n\nTASK: Обясни хода. Обърни се към играча като "${persp}". Спомени FACTS.evaluation_state ИЛИ FACTS.material_balance, когато описваш позицията — те са твоят анкор. Не цитирай конкретни фигури или полета извън FACTS.your_pieces и FACTS.opponent_pieces. Без шахматна нотация. Без JSON. Само естествен език на български.`;
  }
  if (language === "es") {
    const persp = input.user_perspective
      ? "tú"
      : input.player === "White"
        ? "Blancas"
        : "Negras";
    return `FACTS:\n${factsJson}\n\nTASK: Explica la jugada. Dirígete al jugador como "${persp}". Usa FACTS.evaluation_state O FACTS.material_balance al describir la posición; ese es tu ancla. NO menciones ninguna pieza o casilla fuera de FACTS.your_pieces y FACTS.opponent_pieces. Sin notación de ajedrez. Sin JSON. Solo lenguaje natural, en español.`;
  }

  const persp = input.user_perspective ? "you" : input.player;
  return `FACTS:\n${factsJson}\n\nTASK: Explain the move. Address the player as "${persp}". Use FACTS.evaluation_state OR FACTS.material_balance when describing the position — that's your anchor. Do NOT mention any piece or square outside FACTS.your_pieces and FACTS.opponent_pieces. No chess notation. No JSON. Natural language only, in English.`;
}

export function hintPrompt(
  fen: string,
  audience: Audience,
  language: Language,
  history: string[] = [],
): string {
  const recent = recentMovesNatural(history, language, audience, 5);
  const phaseGuess =
    history.length < 14
      ? "opening"
      : history.length < 50
        ? "middlegame"
        : "endgame";
  const facts = {
    lang: language,
    audience,
    side_to_move: fen.split(" ")[1] === "w" ? "white" : "black",
    history_recent: recent,
    phase: phaseGuess,
  };
  const factsJson = JSON.stringify(facts, null, 2);

  if (language === "bg") {
    return `FACTS:\n${factsJson}\n\nTASK: Дай концептуален намек за позицията — НЕ казвай конкретен ход, фигура или продължение. Покажи накъде да гледаме. Без шахматна нотация. 1-2 изречения на български.`;
  }
  if (language === "es") {
    return `FACTS:\n${factsJson}\n\nTASK: Da una pista conceptual sobre la posición — NO nombres una jugada, pieza o continuación específica. Orienta hacia dónde mirar. Sin notación de ajedrez. 1-2 frases en español.`;
  }
  return `FACTS:\n${factsJson}\n\nTASK: Give a conceptual hint about the position — do NOT name a specific move, piece, or continuation. Point at the right idea. No chess notation. 1-2 sentences in English.`;
} // ─────────────────────────────────────────────────────────────────────────────
// Compatibility helpers retained for legacy callers (coach/review.ts uses
// pieceNatural and recentMovesSan). New code should reach for the typed
// builders above.
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated — use sanToNatural directly. Kept so review.ts keeps compiling
 *  during the migration. */
export function pieceNatural(
  san: string,
  fenBefore: string,
  language: Language = "en",
  audience: Audience = "beginner",
): string {
  return sanToNatural(san, fenBefore, language, audience);
}

/** Recent moves in compact natural language joined with commas. Kept for
 *  callers that want a single string rather than an array. */
export function recentMovesSan(history: string[], maxPlies = 8): string {
  if (!history.length) return "—";
  return recentMovesNatural(history, "en", "beginner", maxPlies).join("; ");
}

/** @deprecated — board ASCII is no longer emitted to the LLM (spec §9.6).
 *  Retained so any debug caller compiles. */
export function fenToContext(
  fen: string,
  _language: Language = "en",
  _audience: Audience = "beginner",
): string {
  return `(FEN: ${fen})`;
}
