import { Chess } from "chess.js";
import { cpToWinPct } from "../chess/classifier.js";
import type { Audience, Language, Classification } from "../types.js";
import { verdictPhrase, PIECE_VALUE } from "./locales.js";
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
  de: "du",
  ru: "ты",
  fa: "تو",
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

// How long a coaching answer may be. The coach has more to say than the old
// narrator (why, the better idea, the player's pattern), so this overrides
// the audience block's sentence count.
const EXPLAIN_SENTENCES: Record<Audience, number> = { kid: 3, beginner: 4, intermediate: 5, advanced: 5 };
const HINT_SENTENCES: Record<Audience, number> = { kid: 2, beginner: 3, intermediate: 3, advanced: 3 };

function explainTask(language: Language, audience: Audience, input: ExplainMoveInput, tone: string): string {
  const n = EXPLAIN_SENTENCES[audience];
  const own = input.user_perspective;
  if (language === "bg") {
    const persp = own ? "ти" : input.player === "White" ? "Бели" : "Черни";
    return `TASK: Коучвай играча за този ход, в този ред:
1. Кажи ясно какъв е ходът (FACTS.verdict).${tone === "correct" ? " Без никаква похвала." : ""}
2. Обясни ЗАЩО с FACTS.why и FACTS.opponent_reply — конкретното последствие на дъската.
3. Ако има FACTS.better_move, покажи по-добрата идея и какво постига; спомени един от FACTS.other_good_moves, ако има.
4. Ако FACTS.player_history има запис, свържи хода с него в едно изречение.
5. Завърши с FACTS.takeaway като правило за запомняне или с един кратък въпрос, който кара играча да погледне дъската.
Пропусни стъпка, чието поле във FACTS е празно. Обръщай се към играча като "${persp}". Най-много ${n} изречения — това е с предимство пред блока за аудиторията. Само FACTS. Без шахматна нотация. Без JSON. Само естествен език на български.`;
  }
  if (language === "es") {
    const persp = own ? "tú" : input.player === "White" ? "Blancas" : "Negras";
    return `TASK: Entrena al jugador sobre esta jugada, en este orden:
1. Di claramente qué tipo de jugada fue (FACTS.verdict).${tone === "correct" ? " Ningún elogio." : ""}
2. Explica POR QUÉ con FACTS.why y FACTS.opponent_reply: la consecuencia concreta en el tablero.
3. Si hay FACTS.better_move, muestra la idea mejor y lo que consigue; menciona una de FACTS.other_good_moves si la hay.
4. Si FACTS.player_history tiene una entrada, conecta la jugada con ella en una frase.
5. Termina con FACTS.takeaway como regla para recordar, o con una pregunta breve que haga mirar el tablero.
Omite un paso cuyo campo de FACTS esté vacío. Dirígete al jugador como "${persp}". Como máximo ${n} frases; esto prevalece sobre el bloque de audiencia. Solo FACTS. Sin notación de ajedrez. Sin JSON. Solo lenguaje natural, en español.`;
  }
  if (language === "de") {
    // Not 'Sprich ihn mit "du" an' — small models read that literally and
    // tack "du" on as a form of address ("Gut gemacht, du!").
    const address = own
      ? 'Duze den Spieler, aber ohne Begrüßung und ohne "du" als Anrede.'
      : `Sprich den Spieler mit "${input.player === "White" ? "Weiß" : "Schwarz"}" an.`;
    return `TASK: Coache den Spieler zu diesem Zug, in dieser Reihenfolge:
1. Sag klar, was für ein Zug es war (FACTS.verdict).${tone === "correct" ? " Kein Lob." : ""}
2. Erkläre WARUM mit FACTS.why und FACTS.opponent_reply: die konkrete Folge auf dem Brett.
3. Wenn FACTS.better_move gesetzt ist, zeig die bessere Idee und was sie erreicht; nenne einen von FACTS.other_good_moves, falls vorhanden.
4. Wenn FACTS.player_history einen Eintrag hat, verbinde den Zug in einem Satz damit.
5. Schließe mit FACTS.takeaway als Merkregel oder mit einer kurzen Frage, die den Spieler aufs Brett schauen lässt.
Lass einen Schritt aus, wenn sein Feld in FACTS leer ist. ${address} Höchstens ${n} Sätze — das hat Vorrang vor dem Zielgruppen-Block. Nur FACTS. Keine Schachnotation. Kein JSON. Nur natürliche Sprache, auf Deutsch.`;
  }
  if (language === "ru") {
    const persp = own ? "ты" : input.player === "White" ? "Белые" : "Чёрные";
    return `TASK: Разбери с игроком этот ход как тренер, в таком порядке:
1. Прямо скажи, что это за ход (FACTS.verdict).${tone === "correct" ? " Никакой похвалы." : ""}
2. Объясни, ПОЧЕМУ, по FACTS.why и FACTS.opponent_reply — конкретное последствие на доске.
3. Если есть FACTS.better_move, покажи идею получше и что она даёт; назови один из FACTS.other_good_moves, если он есть.
4. Если в FACTS.player_history есть запись, свяжи с ней этот ход одним предложением.
5. Закончи FACTS.takeaway как правилом на будущее или одним коротким вопросом, который заставит посмотреть на доску.
Пропусти шаг, если его поле в FACTS пустое. Обращайся к игроку как "${persp}", без глаголов прошедшего времени с родом. Не больше ${n} предложений — это важнее блока аудитории. Только FACTS. Без шахматной нотации. Без JSON. Только естественный язык, по-русски.`;
  }
  if (language === "fa") {
    const persp = own ? "تو" : input.player === "White" ? "سفید" : "سیاه";
    return `TASK: دربارهٔ این حرکت مثل یک مربی با بازیکن حرف بزن، به این ترتیب:
1. صریح بگو این چه نوع حرکتی بود (FACTS.verdict).${tone === "correct" ? " هیچ تحسینی نکن." : ""}
2. با FACTS.why و FACTS.opponent_reply توضیح بده چرا — پیامد مشخص روی صفحه.
3. اگر FACTS.better_move هست، ایدهٔ بهتر و دستاوردش را نشان بده؛ اگر در FACTS.other_good_moves چیزی هست، یکی را نام ببر.
4. اگر FACTS.player_history موردی دارد، این حرکت را در یک جمله به آن ربط بده.
5. با FACTS.takeaway به‌عنوان قاعده‌ای برای به خاطر سپردن تمام کن، یا با یک سؤال کوتاه که بازیکن را وادار کند به صفحه نگاه کند.
هر مرحله‌ای را که فیلدش در FACTS خالی است رد کن. بازیکن را «${persp}» خطاب کن. حداکثر ${n} جمله — این بر بلوک مخاطب مقدم است. فقط FACTS. بدون نمادنویسی شطرنج. بدون JSON. فقط زبان طبیعی، به فارسی.`;
  }
  const persp = own ? "you" : input.player;
  return `TASK: Coach the player on this move, in this order:
1. Say plainly what kind of move it was (FACTS.verdict).${tone === "correct" ? " No praise at all." : ""}
2. Explain WHY, using FACTS.why and FACTS.opponent_reply: the concrete consequence on the board.
3. If FACTS.better_move is set, show the better idea and what it achieves; mention one of FACTS.other_good_moves if there is one.
4. If FACTS.player_history has an entry, connect this move to it in one sentence.
5. Finish with FACTS.takeaway as a rule to remember, or with one short question that makes the player look at the board.
Skip any step whose FACTS field is empty. Address the player as "${persp}". At most ${n} sentences — this overrides the audience block. Use only FACTS. No chess notation. No JSON. Natural language only, in English.`;
}

/** Build the user-message body for /api/coach/explain. `coaching` is what
 *  coaching.ts worked out (why, alternatives, history); it goes first so a
 *  small model reads the verdict and the reasons before the inventory. */
export function explainMovePrompt(
  input: ExplainMoveInput,
  language: Language,
  audience: Audience = "beginner",
  coaching: Record<string, unknown> = {},
  correction?: string,
): string {
  const facts = { ...coaching, ...factsForExplain(input, language, audience), ...coaching };
  const factsJson = JSON.stringify(facts, null, 2);
  const tone = String(coaching.tone ?? "");
  const task = explainTask(language, audience, input, tone);
  return `FACTS:\n${factsJson}\n\n${task}${correction ? `\n\n${correction}` : ""}`;
}

/** Sent with a retry when the first answer contradicted the verdict. */
export function correctionNote(language: Language, verdict: string): string {
  const notes: Record<Language, string> = {
    en: `IMPORTANT: your previous answer contradicted FACTS.verdict ("${verdict}"). Begin with that verdict and do not praise the move.`,
    bg: `ВАЖНО: предишният ти отговор противоречи на FACTS.verdict ("${verdict}"). Започни с тази оценка и не хвали хода.`,
    es: `IMPORTANTE: tu respuesta anterior contradecía FACTS.verdict ("${verdict}"). Empieza con ese veredicto y no elogies la jugada.`,
    de: `WICHTIG: Deine vorige Antwort widersprach FACTS.verdict ("${verdict}"). Beginne mit diesem Urteil und lobe den Zug nicht.`,
    ru: `ВАЖНО: твой прошлый ответ противоречил FACTS.verdict ("${verdict}"). Начни с этого вердикта и не хвали ход.`,
    fa: `مهم: پاسخ قبلی‌ات با FACTS.verdict ("${verdict}") در تناقض بود. با همین حکم شروع کن و حرکت را تحسین نکن.`,
  };
  return notes[language] ?? notes.en;
}

export function hintPrompt(
  fen: string,
  audience: Audience,
  language: Language,
  history: string[] = [],
  coaching: Record<string, unknown> = {},
): string {
  const recent = recentMovesNatural(history, language, audience, 5);
  const facts = {
    ...coaching,
    lang: language,
    audience,
    side_to_move: fen.split(" ")[1] === "w" ? "white" : "black",
    history_recent: recent,
  };
  const factsJson = JSON.stringify(facts, null, 2);
  const n = HINT_SENTENCES[audience];

  if (language === "bg") {
    return `FACTS:\n${factsJson}\n\nTASK: Коучвай играча преди хода му. НЕ казвай най-добрия ход и никакъв конкретен ход. С FACTS.where_to_look и FACTS.best_move_idea покажи какво е важно в позицията и защо; ако FACTS.player_history има запис, напомни му за този навик. Завърши с един въпрос, който го кара да погледне дъската. Най-много ${n} изречения. Без шахматна нотация. Само естествен език на български.`;
  }
  if (language === "es") {
    return `FACTS:\n${factsJson}\n\nTASK: Entrena al jugador antes de su jugada. NO digas la mejor jugada ni ninguna jugada concreta. Con FACTS.where_to_look y FACTS.best_move_idea, señala lo importante de la posición y por qué; si FACTS.player_history tiene una entrada, recuérdale ese hábito. Termina con una pregunta que le haga mirar el tablero. Como máximo ${n} frases. Sin notación de ajedrez. Solo lenguaje natural, en español.`;
  }
  if (language === "de") {
    return `FACTS:\n${factsJson}\n\nTASK: Coache den Spieler vor seinem Zug. Nenne NICHT den besten Zug und keinen konkreten Zug. Zeig mit FACTS.where_to_look und FACTS.best_move_idea, worauf es in der Stellung ankommt und warum; hat FACTS.player_history einen Eintrag, erinnere an diese Gewohnheit. Schließe mit einer Frage, die ihn aufs Brett schauen lässt. Höchstens ${n} Sätze. Keine Schachnotation. Nur natürliche Sprache, auf Deutsch.`;
  }
  if (language === "ru") {
    return `FACTS:\n${factsJson}\n\nTASK: Помоги игроку как тренер перед его ходом. НЕ называй лучший ход и вообще конкретные ходы. По FACTS.where_to_look и FACTS.best_move_idea покажи, что важно в позиции и почему; если в FACTS.player_history есть запись, напомни об этой привычке. Закончи одним вопросом, который заставит посмотреть на доску. Не больше ${n} предложений. Без шахматной нотации. Только естественный язык, по-русски.`;
  }
  if (language === "fa") {
    return `FACTS:\n${factsJson}\n\nTASK: پیش از حرکت بازیکن مثل یک مربی کمکش کن. بهترین حرکت یا هیچ حرکت مشخصی را نگو. با FACTS.where_to_look و FACTS.best_move_idea نشان بده چه چیزی در این موقعیت مهم است و چرا؛ اگر FACTS.player_history موردی دارد، آن عادت را یادش بینداز. با یک سؤال تمام کن که او را وادار کند به صفحه نگاه کند. حداکثر ${n} جمله. بدون نمادنویسی شطرنج. فقط زبان طبیعی، به فارسی.`;
  }
  return `FACTS:\n${factsJson}\n\nTASK: Coach the player before their move. Do NOT name the best move or any concrete move. Using FACTS.where_to_look and FACTS.best_move_idea, point out what matters in this position and why; if FACTS.player_history has an entry, remind them of that habit. End with one question that makes them look at the board. At most ${n} sentences. No chess notation. Natural language only, in English.`;
}
