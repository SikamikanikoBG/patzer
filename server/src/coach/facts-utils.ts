import { Chess } from "chess.js";
import type { Audience, Language } from "../types.js";
import { deForm, pieceNames } from "./locales.js";
import { sanToNatural } from "./moves.js";

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

export function evaluationStateNatural(
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

    case "de":
      switch (key) {
        case "winning":
          return "gewonnen";
        case "clearly_better":
          return "klar besser";
        case "slightly_better":
          return "etwas besser";
        case "equal":
          return "ausgeglichen";
        case "slightly_worse":
          return "etwas schlechter";
        case "clearly_worse":
          return "klar schlechter";
        case "losing":
          return "verloren";
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
          case "de":
            location = `${pieceName} auf ${sq}`;
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
      case "de":
        return n === 1 ? `${n} ${names.P}` : `${n} Bauern`;
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
export function materialBalanceNatural(
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
    if (language === "de") return "das Material ist ausgeglichen";
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
      else if (language === "de") pieceLabel = `${abs.toFixed(0)} Bauern`;
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
  if (language === "de") {
    // "2 Bauern" already carries its number; a single piece needs "einen".
    const label = /^\d/.test(pieceLabel) ? pieceLabel : deForm(pieceLabel, "einAkk");
    return ahead ? `du hast ${label} mehr` : `du hast ${label} weniger`;
  }
  return ahead ? `you are up a ${pieceLabel}` : `you are down a ${pieceLabel}`;
}

export function parseMoveDetail(
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