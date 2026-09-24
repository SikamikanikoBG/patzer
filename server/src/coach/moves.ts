import { Chess } from "chess.js";
import type { Audience, Language } from "../types.js";
import { deForm, pieceNames } from "./locales.js";

// gets "the knight to f7". Used to build FACTS payloads — the LLM never sees
// SAN directly.
// ─────────────────────────────────────────────────────────────────────────────

const CASTLE_SHORT: Record<Language, string> = {
  en: "short castles",
  bg: "къса рокада",
  es: "enroque corto",
  de: "kurze Rochade",
};

const CASTLE_LONG: Record<Language, string> = {
  en: "long castles",
  bg: "дълга рокада",
  es: "enroque largo",
  de: "lange Rochade",
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
  de: {
    capture: ({ pieceName, captured, to }) =>
      `${deForm(pieceName, "nom")} schlägt ${deForm(captured!, "akk")} auf ${to}`,
    pawn: ({ pieceName, to }) => `${deForm(pieceName, "nom")} nach ${to}`,
    default: ({ pieceName, from, to }) =>
      `${deForm(pieceName, "nom")} von ${from} nach ${to}`,
    suffix: ({ promo, isCheck, isMate }) => {
      let extra = "";
      if (promo) extra += `, Umwandlung in ${deForm(promo, "einAkk")}`;
      if (isMate) extra += " (Schachmatt)";
      else if (isCheck) extra += " (Schach)";
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
