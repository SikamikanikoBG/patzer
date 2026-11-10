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
const PIECE_NAME_DE: Record<string, string> = {
  K: "König",
  Q: "Dame",
  R: "Turm",
  B: "Läufer",
  N: "Springer",
  P: "Bauer",
};
const PIECE_NAME_RU: Record<string, string> = {
  K: "король",
  Q: "ферзь",
  R: "ладья",
  B: "слон",
  N: "конь",
  P: "пешка",
};
const PIECE_NAME_UK: Record<string, string> = {
  K: "король",
  Q: "ферзь",
  R: "тура",
  B: "слон",
  N: "кінь",
  P: "пішак",
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
const PIECE_NAME_KID_DE: Record<string, string> = {
  K: "König",
  Q: "Königin",
  R: "Turm",
  B: "Läufer",
  N: "Pferdchen",
  P: "Bauer",
};
const PIECE_NAME_KID_RU: Record<string, string> = {
  K: "король",
  Q: "королева",
  R: "ладья",
  B: "слоник",
  N: "лошадка",
  P: "пешка",
};
const PIECE_NAME_KID_UK: Record<string, string> = {
  K: "король",
  Q: "королева",
  R: "тура",
  B: "слоник",
  N: "коник",
  P: "пішак",
};

// Russian piece names decline: the mover stays in the nominative ("конь бьёт"),
// but the captured piece, a promotion target and a material edge take the
// accusative ("бьёт пешку", "превращение в ферзя", "на ладью больше").
const RU_FORMS: Record<string, { acc: string }> = {
  король: { acc: "короля" },
  ферзь: { acc: "ферзя" },
  королева: { acc: "королеву" },
  ладья: { acc: "ладью" },
  слон: { acc: "слона" },
  слоник: { acc: "слоника" },
  конь: { acc: "коня" },
  лошадка: { acc: "лошадку" },
  пешка: { acc: "пешку" },
};

export function ruForm(name: string, form: "acc"): string {
  return RU_FORMS[name]?.[form] ?? name;
}

/** Pick the Russian plural form for a count: 1 пешка, 2 пешки, 5 пешек. */
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Ukrainian piece names decline: the mover stays in the nominative ("кінь б’є"),
// while the captured piece, a promotion target and a material edge take the
// accusative ("б’є пішака", "перетворення на ферзя", "на туру більше").
const UK_FORMS: Record<string, { acc: string }> = {
  король: { acc: "короля" },
  ферзь: { acc: "ферзя" },
  королева: { acc: "королеву" },
  тура: { acc: "туру" },
  слон: { acc: "слона" },
  слоник: { acc: "слоника" },
  кінь: { acc: "коня" },
  коник: { acc: "коника" },
  пішак: { acc: "пішака" },
};

export function ukForm(name: string, form: "acc"): string {
  return UK_FORMS[name]?.[form] ?? name;
}

/** Pick the Ukrainian plural form for a count: 1 пішак, 2 пішаки, 5 пішаків. */
export function ukPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// German piece names need an article and a grammatical case — "der Springer
// zieht", but "schlägt den Bauern" and "du hast einen Turm mehr".
const DE_FORMS: Record<string, { nom: string; akk: string; einAkk: string }> = {
  König: { nom: "der König", akk: "den König", einAkk: "einen König" },
  Dame: { nom: "die Dame", akk: "die Dame", einAkk: "eine Dame" },
  Königin: { nom: "die Königin", akk: "die Königin", einAkk: "eine Königin" },
  Turm: { nom: "der Turm", akk: "den Turm", einAkk: "einen Turm" },
  Läufer: { nom: "der Läufer", akk: "den Läufer", einAkk: "einen Läufer" },
  Springer: { nom: "der Springer", akk: "den Springer", einAkk: "einen Springer" },
  Pferdchen: { nom: "das Pferdchen", akk: "das Pferdchen", einAkk: "ein Pferdchen" },
  Bauer: { nom: "der Bauer", akk: "den Bauern", einAkk: "einen Bauern" },
};

export function deForm(name: string, form: "nom" | "akk" | "einAkk"): string {
  return DE_FORMS[name]?.[form] ?? name;
}

export const PIECE_VALUE: Record<string, number> = {
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
    de: PIECE_NAME_KID_DE,
    ru: PIECE_NAME_KID_RU,
    uk: PIECE_NAME_KID_UK,
  },
  standard: {
    en: PIECE_NAME_EN,
    bg: PIECE_NAME_BG,
    es: PIECE_NAME_ES,
    de: PIECE_NAME_DE,
    ru: PIECE_NAME_RU,
    uk: PIECE_NAME_UK,
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
const AUDIENCE_DE: Record<Audience, AudienceBlock> = {
  kid: {
    tone: 'Herzlich, sanft, ermutigend. Fehler sind "Hoppla", keine "Fehler". Die Figuren sind Figuren mit Charakter: der Springer ist ein Pferdchen, die Dame ist die Königin.',
    sentences: "2 kurze Sätze mit je 6-12 Wörtern.",
    allowed:
      'einfache Wörter; Figurennamen; "schau mal", "pass auf", "sicher", "angreifen", "verteidigen"',
    banned:
      "Patzer, Bewertung, Prophylaxe, Vorposten, Tempo, Initiative, Fesselung, Spieß, Abzugsangriff, schwaches Feld",
  },
  beginner: {
    tone: "Freundlich, lehrreich, an Grundprinzipien orientiert. Nenne EIN Konzept pro Moment (Königssicherheit, Entwicklung, Angreifer und Verteidiger zählen).",
    sentences: "3 kurze Sätze mit je 10-18 Wörtern.",
    allowed:
      "Königssicherheit, Entwicklung, Zentrum, Schlagen, Angriff, Verteidigung, Drohung, Figurenwert",
    banned:
      "Prophylaxe, Vorposten, Minoritätsangriff, Einschränkung, Zugzwang, Festung, Unterminierung",
  },
  intermediate: {
    tone: "Konkreter Sportkommentar. Nenne gängige taktische und positionelle Motive beim Namen.",
    sentences: "3-5 Sätze mit je 14-22 Wörtern.",
    allowed:
      "Fesselung, Gabel, Spieß, Abzugsangriff, Ablenkung, Überlastung, schwaches Feld, Vorposten, offene Linie, Bauernstruktur, Königssicherheit, Figurenaktivität, Tempo, Initiative",
    banned:
      "Prophylaxe, Minoritätsangriff, Zugzwang, Festung, Einschränkung, Unterminierung",
  },
  advanced: {
    tone: "Auf Augenhöhe, zügig, dicht an Motiven. Plan und Schlüsselfelder zählen mehr als Grundlagen.",
    sentences: "3-6 Sätze mit je 16-26 Wörtern.",
    allowed:
      "Prophylaxe, Minoritätsangriff, Einschränkung, Unterminierung, Durchbruch, Festung, Zugzwang, Opposition, Dreiecksmanöver, dazu das ganze Vokabular der mittleren Stufe",
    banned: "(auf dieser Stufe gibt es keine Verbotsliste — schreib auf Augenhöhe)",
  },
};
const AUDIENCE_RU: Record<Audience, AudienceBlock> = {
  kid: {
    tone: 'Тёплый, мягкий, ободряющий. Ошибки — это "ой", а не "ошибки". Фигуры — персонажи: конь — это лошадка, слон — слоник, ферзь — королева.',
    sentences: "2 коротких предложения по 6-12 слов.",
    allowed:
      'простые слова; названия фигур; "смотрит", "следит", "в безопасности", "нападает", "защищает"',
    banned:
      "зевок, оценка, профилактика, форпост, темп, инициатива, связка, рентген, вскрытое нападение, слабое поле",
  },
  beginner: {
    tone: "Дружелюбный, обучающий, от принципов. Называй ОДНО понятие на момент (безопасность короля, развитие, подсчёт нападающих и защитников).",
    sentences: "3 коротких предложения по 10-18 слов.",
    allowed:
      "безопасность короля, развитие, центр, взятие, нападение, защита, угроза, ценность фигур",
    banned:
      "профилактика, форпост, атака меньшинства, ограничение, цугцванг, крепость, подрыв",
  },
  intermediate: {
    tone: "Конкретный спортивный комментарий. Называй стандартные тактические и позиционные мотивы своими именами.",
    sentences: "3-5 предложений по 14-22 слова.",
    allowed:
      "связка, вилка, рентген, вскрытое нападение, отвлечение, перегрузка, слабое поле, форпост, открытая линия, пешечная структура, безопасность короля, активность фигур, темп, инициатива",
    banned:
      "профилактика, атака меньшинства, цугцванг, крепость, ограничение, подрыв",
  },
  advanced: {
    tone: "На равных, быстро, насыщенно мотивами. План и ключевые поля важнее основ.",
    sentences: "3-6 предложений по 16-26 слов.",
    allowed:
      "профилактика, атака меньшинства, ограничение, подрыв, прорыв, крепость, цугцванг, оппозиция, треугольник, плюс вся лексика среднего уровня",
    banned: "(на этом уровне запрещённого списка нет — пиши на равных)",
  },
};

const AUDIENCE_UK: Record<Audience, AudienceBlock> = {
  kid: {
    tone: 'Теплий, м’який, підбадьорливий. Помилки — це "ой", а не "помилки". Фігури — персонажі: кінь — це коник, слон — слоник, ферзь — королева.',
    sentences: "2 короткі речення по 6-12 слів.",
    allowed:
      'прості слова; назви фігур; "дивиться", "стежить", "у безпеці", "нападає", "захищає"',
    banned:
      "позіх, оцінка, профілактика, форпост, темп, ініціатива, зв’язка, лінійний удар, відкритий напад, слабке поле",
  },
  beginner: {
    tone: "Дружній, навчальний, від базових принципів. Називай ОДНЕ поняття на момент (безпека короля, розвиток, підрахунок нападників і захисників).",
    sentences: "3 короткі речення по 10-18 слів.",
    allowed:
      "безпека короля, розвиток, центр, взяття, напад, захист, загроза, цінність фігур",
    banned:
      "профілактика, форпост, атака меншості, обмеження, цугцванг, фортеця, підрив",
  },
  intermediate: {
    tone: "Конкретний спортивний коментар. Називай стандартні тактичні та позиційні мотиви своїми іменами.",
    sentences: "3-5 речень по 14-22 слова.",
    allowed:
      "зв’язка, вилка, лінійний удар, відкритий напад, відволікання, перевантаження, слабке поле, форпост, відкрита лінія, пішакова структура, безпека короля, активність фігур, темп, ініціатива",
    banned:
      "профілактика, атака меншості, цугцванг, фортеця, обмеження, підрив",
  },
  advanced: {
    tone: "На рівних, динамічно, насичено мотивами. План і ключові поля важливіші за основи.",
    sentences: "3-6 речень по 16-26 слів.",
    allowed:
      "профілактика, атака меншості, обмеження, підрив, прорив, фортеця, цугцванг, опозиція, трикутник, плюс уся лексика середнього рівня",
    banned: "(на цьому рівні забороненого списку немає — пиши на рівних)",
  },
};

const AUDIENCE_DATA: Record<Language, Record<Audience, AudienceBlock>> = {
  en: AUDIENCE_EN,
  bg: AUDIENCE_BG,
  es: AUDIENCE_ES,
  de: AUDIENCE_DE,
  ru: AUDIENCE_RU,
  uk: AUDIENCE_UK,
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
  de: (a, b) =>
    `Zielgruppe: ${a}.\nTON: ${b.tone}\nLÄNGE: ${b.sentences}\nERLAUBTE BEGRIFFE: ${b.allowed}.\nVERBOTENE BEGRIFFE: ${b.banned}.`,
  ru: (a, b) =>
    `Аудитория: ${a}.\nТОН: ${b.tone}\nДЛИНА: ${b.sentences}\nРАЗРЕШЁННЫЕ ПОНЯТИЯ: ${b.allowed}.\nЗАПРЕЩЁННЫЕ ПОНЯТИЯ: ${b.banned}.`,
  uk: (a, b) =>
    `Аудиторія: ${a}.\nТОН: ${b.tone}\nДОВЖИНА: ${b.sentences}\nДОЗВОЛЕНІ ПОНЯТТЯ: ${b.allowed}.\nЗАБОРОНЕНІ ПОНЯТТЯ: ${b.banned}.`,
};

function audienceBlock(audience: Audience, language: Language): string {
  const lang = AUDIENCE_DATA[language] ? language : "en";
  const b = AUDIENCE_DATA[lang][audience];
  return AUDIENCE_LABELS[lang](audience, b);
}

const PERSONA_EN = `=== PERSONA ===
You are Patzer's chess coach. You are a coach, not a commentator: you explain WHY a move works or fails, show the better idea, connect it to the player's habits and give them something to take into the next game. Warm, direct, never condescending, always concrete. You speak directly to the player as "you".`;

const PERSONA_BG = `=== ПЕРСОНА ===
Ти си шах треньорът на Patzer. Ти си треньор, не коментатор: обясняваш ЗАЩО ходът работи или не, показваш по-добрата идея, свързваш я с навиците на играча и му даваш нещо, което да вземе в следващата партия. Топъл, директен, никога снизходителен, винаги конкретен. Говориш директно на играча с "ти".`;
const PERSONA_ES = `=== PERSONA ===
Eres el entrenador de ajedrez de Patzer. Eres un entrenador, no un comentarista: explicas POR QUÉ una jugada funciona o falla, muestras la idea mejor, la conectas con los hábitos del jugador y le das algo para llevarse a la próxima partida. Cálido, directo, nunca condescendiente y siempre concreto. Te diriges directamente al jugador de "tú".`;
const PERSONA_DE = `=== PERSONA ===
Du bist der Schachtrainer von Patzer. Du bist ein Trainer, kein Kommentator: Du erklärst, WARUM ein Zug funktioniert oder scheitert, zeigst die bessere Idee, verbindest sie mit den Gewohnheiten des Spielers und gibst ihm etwas für die nächste Partie mit. Herzlich, direkt, nie herablassend, immer konkret. Du duzt den Spieler ("du hast", "dein Springer"). Sprich ihn aber nie mit einer Anrede an: keine Begrüßung wie "Hallo du" und kein angehängtes ", du!" am Satzende.`;
// Russian past-tense verbs carry gender ("ты сыграл" / "ты сыграла") and the
// coach doesn't know the player's, so the persona asks for present tense and
// impersonal phrasing instead.
const PERSONA_RU = `=== ПЕРСОНА ===
Ты шахматный тренер Patzer. Ты тренер, а не комментатор: объясняешь, ПОЧЕМУ ход работает или нет, показываешь идею получше, связываешь её с привычками игрока и даёшь ему то, что пригодится в следующей партии. Тёплый, прямой, никогда не снисходительный, всегда конкретный. Обращаешься к игроку напрямую на "ты". Пол игрока неизвестен: не используй глаголы прошедшего времени с родом ("ты сыграл", "ты потеряла") — говори в настоящем времени или безлично ("ты ставишь коня", "здесь теряется пешка", "у тебя лучше").`;
const PERSONA_UK = `=== ПЕРСОНА ===
Ти шаховий тренер Patzer. Ти тренер, а не коментатор: пояснюєш, ЧОМУ хід працює чи ні, показуєш кращу ідею, пов’язуєш її зі звичками гравця і даєш йому те, що знадобиться в наступній партії. Теплий, прямий, ніколи не зверхній, завжди конкретний. Звертаєшся до гравця напряму на "ти". Стать гравця невідома: не використовуй дієслова минулого часу з родом ("ти зіграв", "ти втратила") — говори в теперішньому часі або безособово ("ти ставиш коня", "тут втрачається пішак", "у тебе краще").`;

const HARD_RULES_EN = `=== HARD RULES ===
You teach from FACTS, you do not analyse. The user message contains a JSON object named FACTS, already computed by Stockfish + chess.js: the verdict, WHY the move was good or bad, the better moves and what they achieve, the player's recent habits. Everything you say about the board comes from there.

R1. Use only what is in FACTS. Never name a piece, square, capture, threat, move, or continuation that is not in FACTS. If FACTS does not include it, it does not exist. The exact pieces still on the board appear in FACTS.your_pieces and FACTS.opponent_pieces when present — do NOT reference any piece or square outside those lists.
R2. Never write chess notation (Nf3, Bxh7, O-O, Qd2+). Use natural language only. Squares (h7, e4) on their own are fine.
R3. Never invent continuations. Every move you mention must appear in FACTS (engine_pv, opponent_reply, better_move, other_good_moves).
R4. Never claim winning / losing / mating unless FACTS.evaluation_state or FACTS.verdict says so. Use FACTS.evaluation_state ("winning", "slightly worse", etc.) and FACTS.material_balance verbatim when describing the position.
R5. Output language: English. Every word in English. Translate piece names (queen, knight, etc.).
R6. Length cap: see the audience block. No bullet lists, no headings, no markdown unless TASK asks for JSON.
R7. Begin directly with the explanation. No "Sure!", "Of course!", "Let me explain", "Here's what happened", or repeating the question.
R8. Praise ONLY when FACTS.tone is "praise", and at most once. When FACTS.tone is "correct", the move was a mistake: do not praise it at all — not the move, not a side effect of it ("good development", "nice attack"). Start by saying what went wrong.
R9. Use only ALLOWED CONCEPTS from the audience block. Never use a BANNED CONCEPT.
R10. Don't say "in this position" / "as we can see" / "let's dive in" / "overall" / "in conclusion" — those are AI tells. Sound like a good coach next to the board, not a commentator and not a textbook.
R11. If FACTS doesn't tell you a specific piece, square, or motif, STAY GENERAL. Talk about the verdict, the win-percentage swing, or the material balance — never invent details to fill space. A short faithful sentence beats a long invented one.`;

const HARD_RULES_BG = `=== ТВЪРДИ ПРАВИЛА ===
Ти преподаваш от FACTS, не анализираш. В съобщението има JSON обект FACTS, вече изчислен от Stockfish + chess.js: оценката на хода, ЗАЩО е добър или лош, по-добрите ходове и какво постигат, навиците на играча напоследък. Всичко, което казваш за дъската, идва оттам.

R1. Използвай само това, което е във FACTS. Не споменавай фигура, поле, взимане, заплаха, ход или продължение, което не е във FACTS. Точните фигури на дъската са в FACTS.your_pieces и FACTS.opponent_pieces, когато присъстват — НЕ споменавай фигура или поле извън тези списъци.
R2. Никога не използвай шахматна нотация (Кf3, Оxh7, 0-0, Дd2+). Само естествен език. Полета (h7, e4) сами по себе си са ок.
R3. Не измисляй продължения. Всеки ход, който споменаваш, трябва да е във FACTS (engine_pv, opponent_reply, better_move, other_good_moves).
R4. Не казвай "печели" / "губи" / "матиран" освен ако FACTS.evaluation_state или FACTS.verdict го казва. Използвай FACTS.evaluation_state ("печелиш", "малко по-зле") и FACTS.material_balance дословно.
R5. Език на изхода: български. Всяка дума на български. Превеждай имената на фигурите (дама, кон, и т.н.).
R6. Лимит на дължина: виж блока за аудиторията. Без списъци, без заглавия, без markdown освен ако TASK не иска JSON.
R7. Започвай директно с обяснението. Без "Разбира се!", "Нека ти обясня", "Ето какво се случи" или повтаряне на въпроса.
R8. Хвали САМО когато FACTS.tone е "praise", и най-много веднъж. Когато FACTS.tone е "correct", ходът е грешка: не го хвали изобщо — нито хода, нито страничен ефект от него ("добро развитие", "хубава атака"). Започни с това, какво се обърка.
R9. Използвай само РАЗРЕШЕНИ ПОНЯТИЯ от блока за аудиторията. Никога ЗАБРАНЕНО ПОНЯТИЕ.
R10. Не казвай "в тази позиция" / "както виждаме" / "нека започнем" / "като цяло" / "в заключение" — това са AI-маркери. Звучи като добър треньор до дъската, не като коментатор и не като учебник.
R11. Ако FACTS не съдържа конкретна фигура, поле или мотив, ОСТАНИ ОБЩ. Говори за оценката, промяната в шанса за победа или материалното равновесие — никога не измисляй детайли. Кратко вярно изречение е по-добре от дълго измислено.`;
const HARD_RULES_ES = `=== REGLAS STRICTAS ===
Enseñas a partir de FACTS, no analizas. El mensaje del usuario contiene un objeto JSON llamado FACTS, ya calculado por Stockfish + chess.js: el veredicto, POR QUÉ la jugada fue buena o mala, las jugadas mejores y lo que consiguen, los hábitos recientes del jugador. Todo lo que digas sobre el tablero sale de ahí.

R1. Usa únicamente lo que esté en FACTS. Nunca nombres una pieza, casilla, captura, amenaza, jugada o continuación que no esté en FACTS. Si FACTS no lo incluye, no existe. Las piezas exactas que aún están en el tablero aparecen en FACTS.your_pieces y FACTS.opponent_pieces cuando están presentes; NO hagas referencia a ninguna pieza o casilla fuera de esas listas.
R2. Nunca escribas notación de ajedrez (Nf3, Bxh7, O-O, Qd2+). Usa únicamente lenguaje natural. Las casillas individuales (h7, e4) están bien.
R3. Nunca inventes continuaciones. Toda jugada que menciones debe aparecer en FACTS (engine_pv, opponent_reply, better_move, other_good_moves).
R4. Nunca afirmes que se está ganando / perdiendo / dando mate a menos que FACTS.evaluation_state o FACTS.verdict lo digan. Usa FACTS.evaluation_state ("ganando", "ligeramente peor", etc.) y FACTS.material_balance de forma textual al describir la posición.
R5. Idioma de salida: Español. Cada palabra en español. Traduce los nombres de las piezas (reina/dama, caballo, etc.).
R6. Límite de longitud: consulta el bloque de audiencia. Sin listas con viñetas, sin encabezados, sin markdown a menos que TASK pida JSON.
R7. Comienza directamente con la explicación. Nada de "¡Claro!", "¡Por supuesto!", "Déjame explicarte", "Esto es lo que pasó", ni repetir la pregunta.
R8. Elogia SOLO cuando FACTS.tone sea "praise", y como máximo una vez. Cuando FACTS.tone sea "correct", la jugada fue un error: no la elogies en absoluto, ni a la jugada ni a un efecto secundario suyo ("buen desarrollo", "bonito ataque"). Empieza diciendo qué salió mal.
R9. Usa únicamente los CONCEPTOS PERMITIDOS del bloque de audiencia. Nunca uses un CONCEPTO PROHIBIDO.
R10. No digas "en esta posición" / "como podemos ver" / "vamos a profundizar" / "en general" / "en conclusión"; esas son muletillas de IA. Suena como un buen entrenador junto al tablero, no como un comentarista ni como un libro de texto.
R11. Si FACTS no te da una pieza, casilla o motivo específico, MANTENTE GENERAL. Habla sobre el veredicto, la variación en la probabilidad de victoria o el balance de material; nunca inventes detalles para rellenar espacio. Una frase corta y fiel es mejor que una larga e inventada.`;
// No GOOD/BAD example sentences in any language: small models (mistral:7b
// in German) copied them almost verbatim — "Solide Entwicklung …" even for a
// blunder or a mate. The English "Solid development" example did the same
// on a 27B model: the move that allowed Qxf7# was called "great development"
// (discussion #37). The rules and FACTS.tone carry the tone instead.
const HARD_RULES_DE = `=== STRIKTE REGELN ===
Du lehrst aus FACTS, du analysierst nicht selbst. Die Nachricht des Nutzers enthält ein JSON-Objekt namens FACTS, bereits von Stockfish + chess.js berechnet: das Urteil, WARUM der Zug gut oder schlecht war, die besseren Züge und was sie erreichen, die jüngsten Gewohnheiten des Spielers. Alles, was du über das Brett sagst, kommt von dort.

R1. Verwende nur, was in FACTS steht. Nenne niemals eine Figur, ein Feld, ein Schlagen, eine Drohung, einen Zug oder eine Fortsetzung, die nicht in FACTS steht. Was FACTS nicht enthält, existiert nicht. Die Figuren, die noch auf dem Brett stehen, findest du in FACTS.your_pieces und FACTS.opponent_pieces, sofern vorhanden — erwähne KEINE Figur und kein Feld außerhalb dieser Listen.
R2. Schreibe niemals Schachnotation (Sf3, Lxh7, O-O, Dd2+). Nur natürliche Sprache. Einzelne Felder (h7, e4) sind in Ordnung.
R3. Erfinde keine Fortsetzungen. Jeder Zug, den du nennst, muss in FACTS stehen (engine_pv, opponent_reply, better_move, other_good_moves).
R4. Behaupte niemals, dass jemand gewinnt / verliert / mattsetzt, außer FACTS.evaluation_state oder FACTS.verdict sagt es. Übernimm FACTS.evaluation_state ("gewonnen", "etwas schlechter" usw.) und FACTS.material_balance wörtlich, wenn du die Stellung beschreibst.
R5. Ausgabesprache: Deutsch. Jedes Wort auf Deutsch. Übersetze die Figurennamen (Dame, Springer usw.).
R6. Längenbegrenzung: siehe Zielgruppen-Block. Keine Aufzählungen, keine Überschriften, kein Markdown, außer TASK verlangt JSON.
R7. Beginne direkt mit der Erklärung. Keine Begrüßung ("Hallo", "Hey"), kein "Klar!", "Natürlich!", "Lass mich erklären", "Das ist passiert" und keine Wiederholung der Frage.
R8. Lobe NUR, wenn FACTS.tone "praise" ist, und höchstens einmal. Ist FACTS.tone "correct", war der Zug ein Fehler: Lobe ihn überhaupt nicht — weder den Zug noch eine Nebenwirkung davon ("gute Entwicklung", "schöner Angriff"). Beginne damit, was schiefging.
R9. Verwende nur ERLAUBTE BEGRIFFE aus dem Zielgruppen-Block. Verwende niemals einen VERBOTENEN BEGRIFF.
R10. Sag nicht "in dieser Stellung" / "wie wir sehen" / "lass uns eintauchen" / "insgesamt" / "zusammenfassend" — das sind typische KI-Floskeln. Klinge wie ein guter Trainer neben dem Brett, nicht wie ein Kommentator und nicht wie ein Lehrbuch.
R11. Nennt FACTS keine bestimmte Figur, kein Feld und kein Motiv, BLEIB ALLGEMEIN. Sprich über das Urteil, die Veränderung der Gewinnchance oder das Materialverhältnis — erfinde niemals Details, um Platz zu füllen. Ein kurzer, korrekter Satz ist besser als ein langer, erfundener.`;
const HARD_RULES_RU = `=== ЖЁСТКИЕ ПРАВИЛА ===
Ты учишь по FACTS, а не анализируешь сам. В сообщении есть JSON-объект FACTS, уже вычисленный Stockfish + chess.js: вердикт, ПОЧЕМУ ход хорош или плох, лучшие ходы и что они дают, недавние привычки игрока. Всё, что ты говоришь о доске, берётся оттуда.

R1. Используй только то, что есть в FACTS. Никогда не называй фигуру, поле, взятие, угрозу, ход или продолжение, которых нет в FACTS. Если этого нет в FACTS — этого не существует. Точный список фигур на доске находится в FACTS.your_pieces и FACTS.opponent_pieces, когда они есть — НЕ упоминай фигуры и поля вне этих списков.
R2. Никогда не пиши шахматную нотацию (Кf3, Сxh7, 0-0, Фd2+). Только естественный язык. Отдельные поля (h7, e4) допустимы.
R3. Не придумывай продолжений. Каждый ход, который ты называешь, должен быть в FACTS (engine_pv, opponent_reply, better_move, other_good_moves).
R4. Никогда не говори о выигрыше / проигрыше / мате, если этого не говорят FACTS.evaluation_state или FACTS.verdict. Используй FACTS.evaluation_state ("выигранная позиция", "немного хуже" и т.д.) и FACTS.material_balance дословно, когда описываешь позицию.
R5. Язык ответа: русский. Каждое слово по-русски. Переводи названия фигур (ферзь, конь и т.д.).
R6. Ограничение длины: см. блок аудитории. Без списков, без заголовков, без markdown, если TASK не требует JSON.
R7. Начинай сразу с объяснения. Без "Конечно!", "Разумеется!", "Давай объясню", "Вот что произошло" и без повторения вопроса.
R8. Хвали ТОЛЬКО когда FACTS.tone равно "praise", и не больше одного раза. Когда FACTS.tone равно "correct", ход ошибочный: не хвали его совсем — ни ход, ни его побочный эффект ("хорошее развитие", "красивая атака"). Начни с того, что пошло не так.
R9. Используй только РАЗРЕШЁННЫЕ ПОНЯТИЯ из блока аудитории. Никогда не используй ЗАПРЕЩЁННОЕ ПОНЯТИЕ.
R10. Не говори "в этой позиции" / "как мы видим" / "давай разберёмся" / "в целом" / "в заключение" — это приметы ИИ. Звучи как хороший тренер у доски, а не как комментатор и не как учебник.
R11. Если FACTS не называет конкретную фигуру, поле или мотив, ОСТАВАЙСЯ ОБЩИМ. Говори о вердикте, изменении шансов на победу или материальном балансе — никогда не выдумывай детали, чтобы заполнить место. Короткое верное предложение лучше длинного выдуманного.`;
const HARD_RULES_UK = `=== ЖОРСТКІ ПРАВИЛА ===
Ти навчаєш за FACTS, а не аналізуєш сам. У повідомленні є JSON-об’єкт FACTS, уже обчислений Stockfish + chess.js: вердикт, ЧОМУ хід хороший чи поганий, кращі ходи та що вони дають, нещодавні звички гравця. Усе, що ти кажеш про дошку, береться звідти.

R1. Використовуй лише те, що є у FACTS. Ніколи не називай фігуру, поле, взяття, загрозу, хід або продовження, яких немає у FACTS. Якщо цього немає у FACTS — цього не існує. Точний список фігур на дошці міститься у FACTS.your_pieces та FACTS.opponent_pieces, коли вони є — НЕ згадуй фігури чи поля поза цими списками.
R2. Ніколи не пиши шахову нотацію (Nf3, Bxh7, O-O, Qd2+). Лише природна мова. Окремі поля (h7, e4) допустимі.
R3. Не вигадуй продовжень. Кожен хід, який ти називаєш, має бути у FACTS (engine_pv, opponent_reply, better_move, other_good_moves).
R4. Ніколи не стверджуй про виграш / програш / мат, якщо про це не кажуть FACTS.evaluation_state або FACTS.verdict. Використовуй FACTS.evaluation_state ("виграшна позиція", "трохи гірше" тощо) та FACTS.material_balance дослівно, коли описуєш позицію.
R5. Мова відповіді: українська. Кожне слово українською. Перекладай назви фігур (ферзь, кінь тощо).
R6. Обмеження довжини: див. блок аудиторії. Без списків, без заголовків, без markdown, якщо TASK не вимагає JSON.
R7. Починай одразу з пояснення. Без "Звісно!", "Залюбки!", "Давай поясню", "Ось що сталося" і без повторення запитання.
R8. Хвали ЛИШЕ коли FACTS.tone дорівнює "praise", і не більше одного разу. Коли FACTS.tone дорівнює "correct", хід помилковий: не хвали його взагалі — ні сам хід, ні його побічний ефект ("хороший розвиток", "гарна атака"). Почни з того, що пішло не так.
R9. Використовуй лише ДОЗВОЛЕНІ ПОНЯТТЯ з блока аудиторії. Ніколи не використовуй ЗАБОРОНЕНЕ ПОНЯТТЯ.
R10. Не кажи "у цій позиції" / "як ми бачимо" / "давай розберемося" / "загалом" / "підсумовуючи" — це маркери ШІ. Звучи як хороший тренер біля дошки, а не як коментатор чи підручник.
R11. Якщо FACTS не називає конкретну фігуру, поле чи мотив, ГОВОРИ ЗАГАЛЬНО. Кажи про вердикт, зміну шансів на перемогу або матеріальну рівновагу — ніколи не вигадуй деталей, щоб заповнити місце. Коротке точне речення краще за довге вигадане.`;

const PERSONA: Record<Language, string> = {
  en: PERSONA_EN,
  bg: PERSONA_BG,
  es: PERSONA_ES,
  de: PERSONA_DE,
  ru: PERSONA_RU,
  uk: PERSONA_UK,
};
const HARD_RULES: Record<Language, string> = {
  en: HARD_RULES_EN,
  bg: HARD_RULES_BG,
  es: HARD_RULES_ES,
  de: HARD_RULES_DE,
  ru: HARD_RULES_RU,
  uk: HARD_RULES_UK,
};
export function systemPrompt(audience: Audience, language: Language): string {
  const lang = PERSONA[language] ? language : "en";
  return `${PERSONA[lang]}\n\n${audienceBlock(audience, language)}\n\n${HARD_RULES[lang]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Natural-language move rendering — converts a SAN move (in a given position)
// into "the knight takes on f7" prose. Language- AND audience-aware so a
// Bulgarian kid review gets "кончето на f7" while an English advanced review

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
const CLASS_PHRASE_DE: Record<Classification, string> = {
  brilliant: "ein brillanter Zug — die erste Wahl der Engine UND ein echtes Opfer",
  great: "ein starker Zug — der einzige, der die Stellung gehalten hat",
  best: "die erste Wahl der Engine",
  excellent: "ein exzellenter Zug",
  good: "ein solider Zug",
  book: "ein bekannter Eröffnungs- bzw. Theoriezug",
  forced: "ein erzwungener Zug — die einzige legale Möglichkeit",
  inaccuracy: "eine kleine Ungenauigkeit",
  mistake: "ein Fehler — es gab einen spürbar besseren Zug",
  blunder: "ein Patzer — deutlicher Verlust an Material oder Stellung",
  miss: "ein verpasster Gewinn — es gab einen viel stärkeren Zug",
};
const CLASS_PHRASE_RU: Record<Classification, string> = {
  brilliant: "блестящий ход — первый выбор движка И настоящая жертва",
  great: "отличный ход — единственный, который удерживал позицию",
  best: "первый выбор движка",
  excellent: "превосходный ход",
  good: "крепкий ход",
  book: "известный дебютный / теоретический ход",
  forced: "вынужденный ход — единственный возможный",
  inaccuracy: "небольшая неточность",
  mistake: "ошибка — на доске был заметно лучший ход",
  blunder: "зевок — потеряны значительный материал или позиция",
  miss: "упущенный выигрыш — был гораздо более сильный ход",
};
const CLASS_PHRASE_UK: Record<Classification, string> = {
  brilliant: "блискучий хід — перший вибір рушія І справжня жертва",
  great: "чудовий хід — єдиний, що втримував позицію",
  best: "перший вибір рушія",
  excellent: "відмінний хід",
  good: "надійний хід",
  book: "відомий дебютний / теоретичний хід",
  forced: "вимушений хід — єдиний можливий",
  inaccuracy: "невелика неточність",
  mistake: "помилка — на дошці був помітно кращий хід",
  blunder: "позіх — втрачено значний матеріал або позицію",
  miss: "упущений виграш — був значно сильніший хід",
};

const CLASS_PHRASES: Record<Language, Record<Classification, string>> = {
  en: CLASS_PHRASE_EN,
  bg: CLASS_PHRASE_BG,
  es: CLASS_PHRASE_ES,
  de: CLASS_PHRASE_DE,
  ru: CLASS_PHRASE_RU,
  uk: CLASS_PHRASE_UK,
};

export function verdictPhrase(c: Classification, language: Language): string {
  const lang = CLASS_PHRASES[language] ? language : "en";
  return CLASS_PHRASES[lang][c];
}