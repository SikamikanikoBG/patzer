import type { Audience, Language, Classification } from "../types.js";
import { pieceNames, verdictPhrase, PIECE_VALUE } from "./locales.js";
import { sanToNatural, pvToNaturalSan, recentMovesNatural } from "./moves.js";
import { evaluationStateNatural, boardPiecesNatural, materialBalanceNatural, parseMoveDetail } from "./facts-utils.js";


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