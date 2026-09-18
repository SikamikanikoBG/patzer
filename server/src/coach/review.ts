// Per-game written Game Review — chess.com Game Report parity.
// Composes Stockfish analysis + ECO + key moments + AI prose into a single
// structured document. Each LLM call is small (< 1.5k tokens) so weak local
// models (gemma2:2b, qwen2.5:3b) reliably hold the JSON schema.
//
// v2 (chess.com parity pass):
// - Slot-fills each prose field into {title, what_happened, why_it_matters,
//   what_to_learn} instead of asking for "3-4 sentences of analysis". The
//   slot-fill cuts hallucination dramatically on small models — see
//   .claude/specs/coach.md §9.5.
// - Renders moves natural-language in the requested LANGUAGE (Bulgarian
//   reviews no longer leak English piece names). Spec bug §9.2.
// - Persona/Hard-Rules system prompt comes from prompts.ts and is woven into
//   the JSON_HARD block as a single numbered rule list (R10 is "respond in
//   JSON"). Spec §9.7, §9.8.
//
// Pipeline (all calls are batched through the orchestrator below; emit
// `progress` events as each step finishes so the UI can render a stepper):
//   1. opening_lookup       — local, instant
//   2. phase:opening prose  — Ollama JSON
//   3. phase:middlegame     — Ollama JSON
//   4. phase:endgame        — Ollama JSON
//   5. moment:i for each    — Ollama JSON (3–5 calls)
//   6. summary              — Ollama JSON (skill_assessment + summary + opening_prose)
//
// Output is cached in `analyses.prose_json`, keyed by (scoring_version,
// prose_version, language, audience). Re-runs only when one of those changes.

import { chatJsonRetry } from './llm.js';
import { systemPrompt, sanToNatural, pvToNaturalSan, verdictPhrase, boardPiecesNatural } from './prompts.js';
import type { AnalysisResult, AnalyzedMove, Audience, Classification, GamePhase, KeyMomentSummary, Language } from '../types.js';

// Bump on every output-shape or prompt change so cached prose at the old
// version is invalidated.
// v2 = chess.com parity pass.
// v3 = anti-hallucination FACTS pass: piece inventory + win-prob in key moments.
export const REVIEW_PROSE_VERSION = 3;

// JSON-mode rule append-on. R10 in the consolidated 10-rule scheme. We use
// "R10:" numbering to extend prompts.ts's existing rule block cleanly.
//
// Every language-dependent string in this file lives in REVIEW_TEXT so adding
// a language is one table entry (same pattern as prompts.ts).
interface ReviewText {
  jsonHard: string;
  perspective: string;
  phase: Record<GamePhase, string>;
  keyMoment: string;
  taskPhase: (phase: string) => string;
  taskMoment: string;
  taskSummary: string;
  fallbackPhase: (phase: string, accuracy: string, plies: number) => string;
  fallbackMoment: (ply: number, verdict: string, cpLoss: number) => string;
  fallbackSummary: (acc: string, brilliant: number, mistakes: number, blunders: number) => string;
  fallbackSkillNone: string;
  fallbackSkill: (elo: number) => string;
  fallbackOpening: (name: string) => string;
}

const REVIEW_TEXT: Record<Language, ReviewText> = {
  en: {
    jsonHard: `\n\nR10. Reply with EXACTLY ONE JSON object matching the schema in TASK. No prose outside the JSON. No markdown fences. No extra keys.`,
    perspective: 'you',
    phase: { opening: 'opening', middlegame: 'middlegame', endgame: 'endgame' },
    keyMoment: 'Key moment',
    taskPhase: (phase) => `TASK: Describe the player's ${phase} in 2-3 sentences. Address as "you". Schema: { "prose": string }`,
    taskMoment: `TASK: Describe this key moment. Address as "you". Slots:
- title: ≤6 words, no period at the end.
- what_happened: 1 sentence — what the player did and the engine's verdict.
- why_it_matters: 1 sentence — the cost or the principle behind it.
- what_to_learn: 1 sentence — the takeaway.
Schema: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskSummary: `TASK: Summarize the game for the player. Address as "you". Schema: { "summary": string (3-4 sentences), "skill_assessment": string (1 sentence on skill), "opening_prose": string (≤2 sentences on the opening) }`,
    fallbackPhase: (phase, accuracy, plies) => `Your ${phase} accuracy was ${accuracy}% across ${plies} plies.`,
    fallbackMoment: (ply, verdict, cpLoss) => `On ply ${ply} the game turned. ${verdict}. The cost was about ${cpLoss} centipawns.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `Your accuracy was ${acc}%. You had ${brilliant} brilliant moves, ${mistakes} mistakes, and ${blunders} blunders.`,
    fallbackSkillNone: 'No skill estimate yet.',
    fallbackSkill: (elo) => `This game played at roughly ${elo} Elo.`,
    fallbackOpening: (name) => `You opened with ${name} — a solid choice.`,
  },
  bg: {
    jsonHard: `\n\nR10. Отговори с ТОЧНО ЕДИН JSON обект според схемата в TASK. Без текст извън JSON. Без markdown. Без допълнителни ключове.`,
    perspective: 'ти',
    phase: { opening: 'дебют', middlegame: 'мителшпил', endgame: 'ендшпил' },
    keyMoment: 'Ключов момент',
    taskPhase: (phase) => `TASK: Опиши играта на играча във фазата ${phase} с 2-3 изречения. Обърни се с "ти". Схема: { "prose": string }`,
    taskMoment: `TASK: Опиши този ключов момент. Обърни се с "ти". Слотове:
- title: ≤6 думи, без точка в края.
- what_happened: 1 изречение — какво направи играчът и оценката на двигателя.
- why_it_matters: 1 изречение — каква е цената или принципът зад грешката/успеха.
- what_to_learn: 1 изречение — какво да запомниш.
Схема: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskSummary: `TASK: Обобщи партията за играча. Обърни се с "ти". Схема: { "summary": string (3-4 изречения), "skill_assessment": string (1 изречение за нивото), "opening_prose": string (≤2 изречения за дебюта) }`,
    fallbackPhase: (phase, accuracy, plies) => `Във фазата ${phase} точността ти беше ${accuracy}% за ${plies} полу-хода.`,
    fallbackMoment: (ply, verdict, cpLoss) => `На полу-ход ${ply} играта се обърна. ${verdict}. Загубата беше около ${cpLoss} стотни от пешка.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `Точността ти беше ${acc}%. Имаше ${brilliant} брилянтни, ${mistakes} грешки и ${blunders} блъндера.`,
    fallbackSkillNone: 'Все още нямаме оценка на нивото.',
    fallbackSkill: (elo) => `Партията ти изглежда на ниво около ${elo} Elo.`,
    fallbackOpening: (name) => `Започна с ${name} — солиден избор.`,
  },
  es: {
    jsonHard: `\n\nR10. Responde con EXACTAMENTE UN objeto JSON que siga el esquema de TASK. Sin texto fuera del JSON. Sin bloques markdown. Sin claves adicionales.`,
    perspective: 'tú',
    phase: { opening: 'apertura', middlegame: 'medio juego', endgame: 'final' },
    keyMoment: 'Momento clave',
    taskPhase: (phase) => `TASK: Describe la ${phase} del jugador en 2-3 frases. Trátalo de "tú". Esquema: { "prose": string }`,
    taskMoment: `TASK: Describe este momento clave. Trata al jugador de "tú". Campos:
- title: ≤6 palabras, sin punto final.
- what_happened: 1 frase — qué hizo el jugador y el veredicto del motor.
- why_it_matters: 1 frase — el coste o el principio detrás de la jugada.
- what_to_learn: 1 frase — la lección.
Esquema: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskSummary: `TASK: Resume la partida para el jugador. Trátalo de "tú". Esquema: { "summary": string (3-4 frases), "skill_assessment": string (1 frase sobre el nivel), "opening_prose": string (≤2 frases sobre la apertura) }`,
    fallbackPhase: (phase, accuracy, plies) => `Tu precisión en la ${phase} fue del ${accuracy}% en ${plies} medias jugadas.`,
    fallbackMoment: (ply, verdict, cpLoss) => `En la media jugada ${ply} la partida cambió. ${verdict}. El coste fue de unos ${cpLoss} centipeones.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `Tu precisión fue del ${acc}%. Tuviste ${brilliant} jugadas brillantes, ${mistakes} errores y ${blunders} errores graves.`,
    fallbackSkillNone: 'Aún no hay una estimación de nivel.',
    fallbackSkill: (elo) => `Esta partida se jugó a un nivel de unos ${elo} Elo.`,
    fallbackOpening: (name) => `Abriste con ${name}: una elección sólida.`,
  },
};

function reviewText(language: Language): ReviewText {
  return REVIEW_TEXT[language] ?? REVIEW_TEXT.en;
}

export interface PhaseProse {
  from_ply: number;
  to_ply: number;
  accuracy: number;
  acpl: number;
  prose: string;
}

export interface KeyMomentProse extends KeyMomentSummary {
  title: string;
  prose: string;
}

export interface GameReview {
  version: number;
  language: Language;
  audience: Audience;
  opening: { eco: string; name: string; prose: string } | null;
  summary: string;
  skill_assessment: string;
  phases: { opening: PhaseProse | null; middlegame: PhaseProse | null; endgame: PhaseProse | null };
  key_moments: KeyMomentProse[];
}

export type ProgressEvent =
  | { step: 'opening' | 'phase:opening' | 'phase:middlegame' | 'phase:endgame' | 'summary'; done: number; total: number }
  | { step: 'moment'; index: number; done: number; total: number };

export interface BuildReviewArgs {
  pgn: string;
  analysis: AnalysisResult;
  language: Language;
  audience: Audience;
  userColor: 'white' | 'black';
  onProgress?: (ev: ProgressEvent) => void;
  signal?: AbortSignal;
}

function totalSteps(args: BuildReviewArgs): number {
  let n = 1; // opening lookup
  if (args.analysis.phase_split?.opening) n++;
  if (args.analysis.phase_split?.middlegame) n++;
  if (args.analysis.phase_split?.endgame) n++;
  n += args.analysis.key_moments.length;
  n += 1; // summary
  return n;
}

function joinSlots(...parts: (string | undefined | null)[]): string {
  return parts.map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
}

async function callPhase(
  phase: GamePhase,
  data: { from_ply: number; to_ply: number; accuracy_white: number; accuracy_black: number; acpl_white: number; acpl_black: number },
  moves: AnalyzedMove[],
  language: Language,
  audience: Audience,
  userColor: 'white' | 'black',
  signal?: AbortSignal,
): Promise<PhaseProse> {
  const userAcc = userColor === 'white' ? data.accuracy_white : data.accuracy_black;
  const userAcpl = userColor === 'white' ? data.acpl_white : data.acpl_black;
  const text = reviewText(language);
  const phaseLabelLocal = text.phase[phase];
  const slice = moves.filter((m) => m.ply >= data.from_ply && m.ply <= data.to_ply);

  // Compact list of interesting moves only (skip best/excellent/good/book/forced).
  const interesting = slice
    .filter((m) => m.classification !== 'best' && m.classification !== 'excellent' && m.classification !== 'good' && m.classification !== 'book' && m.classification !== 'forced')
    .slice(0, 6)
    .map((m) => {
      const side = m.ply % 2 === 1 ? 'white' : 'black';
      const natural = sanToNatural(m.san, m.fen_before, language, audience);
      return { ply: m.ply, side, played_natural: natural, classification: m.classification, cp_loss: m.centipawn_loss };
    });

  const facts = {
    lang: language,
    audience,
    perspective: text.perspective,
    phase,
    user_accuracy: userAcc,
    user_acpl: userAcpl,
    plies_in_phase: slice.length,
    interesting_moves: interesting,
  };

  const sys = systemPrompt(audience, language) + text.jsonHard;
  const task = `FACTS:\n${JSON.stringify(facts, null, 2)}\n\n${text.taskPhase(phaseLabelLocal)}`;

  try {
    const result = await chatJsonRetry<{ prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: task },
    ], { temperature: 0.2, numPredict: 350, signal });
    const prose = (result.prose ?? '').trim() || fallbackPhase(phase, userAcc, slice.length, language);
    return { from_ply: data.from_ply, to_ply: data.to_ply, accuracy: userAcc, acpl: userAcpl, prose };
  } catch {
    return { from_ply: data.from_ply, to_ply: data.to_ply, accuracy: userAcc, acpl: userAcpl, prose: fallbackPhase(phase, userAcc, slice.length, language) };
  }
}

function fallbackPhase(phase: GamePhase, accuracy: number, plies: number, language: Language): string {
  const text = reviewText(language);
  return text.fallbackPhase(text.phase[phase], accuracy.toFixed(1), plies);
}

async function callKeyMoment(
  moment: KeyMomentSummary,
  language: Language,
  audience: Audience,
  signal?: AbortSignal,
): Promise<KeyMomentProse> {
  const played = sanToNatural(moment.san, moment.fen_before, language, audience);
  const best = moment.best_san ? sanToNatural(moment.best_san, moment.fen_before, language, audience) : null;
  const pv = pvToNaturalSan(moment.best_pv, moment.fen_before, language, audience, 3);
  const verdict = verdictPhrase(moment.classification, language);
  // Piece inventory of the position BEFORE the moment — without this, small
  // models hallucinate pieces and squares that aren't on the board.
  const board = boardPiecesNatural(moment.fen_before, moment.side, language, audience);
  const text = reviewText(language);

  const facts = {
    lang: language,
    audience,
    perspective: text.perspective,
    moment: {
      ply: moment.ply,
      side: moment.side,
      played_natural: played,
      best_natural: best,
      engine_pv: pv,
      classification: moment.classification,
      cp_loss: moment.cp_loss,
      win_pct_delta: moment.win_pct_delta,
      verdict,
      // Pieces still on the board at this moment — the model must not name
      // pieces or squares outside this list (R1).
      your_pieces: board.player,
      opponent_pieces: board.opponent,
    },
  };

  const sys = systemPrompt(audience, language) + text.jsonHard;
  const task = `FACTS:\n${JSON.stringify(facts, null, 2)}\n\n${text.taskMoment}`;

  try {
    const result = await chatJsonRetry<{ title?: string; what_happened?: string; why_it_matters?: string; what_to_learn?: string; prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: task },
    ], { temperature: 0.2, numPredict: 400, signal });
    const title = (result.title ?? '').trim() || text.keyMoment;
    // Slot-fill OR legacy `prose` field — accept both for backward compat.
    const prose = result.prose?.trim() || joinSlots(result.what_happened, result.why_it_matters, result.what_to_learn) || fallbackMoment(moment, language);
    return { ...moment, title, prose };
  } catch {
    return { ...moment, title: text.keyMoment, prose: fallbackMoment(moment, language) };
  }
}

function fallbackMoment(m: KeyMomentSummary, language: Language): string {
  const cls = verdictPhrase(m.classification, language);
  return reviewText(language).fallbackMoment(m.ply, cls, m.cp_loss);
}

async function callSummary(
  analysis: AnalysisResult,
  userColor: 'white' | 'black',
  language: Language,
  audience: Audience,
  signal?: AbortSignal,
): Promise<{ summary: string; skill_assessment: string; opening_prose: string }> {
  const userAcc = userColor === 'white' ? analysis.accuracy_white : analysis.accuracy_black;
  const oppAcc = userColor === 'white' ? analysis.accuracy_black : analysis.accuracy_white;
  const userElo = userColor === 'white' ? analysis.estimated_elo_white : analysis.estimated_elo_black;
  const userPerf = userColor === 'white' ? analysis.performance_white : analysis.performance_black;
  const counts: Record<Classification, number> = {
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0,
    forced: 0, inaccuracy: 0, mistake: 0, blunder: 0, miss: 0,
  };
  for (const m of analysis.moves) {
    const side = m.ply % 2 === 1 ? 'white' : 'black';
    if (side !== userColor) continue;
    counts[m.classification]++;
  }

  const text = reviewText(language);
  const facts = {
    lang: language,
    audience,
    perspective: text.perspective,
    your_accuracy: userAcc,
    opponent_accuracy: oppAcc,
    estimated_elo: userElo,
    performance_rating: userPerf,
    classification_counts: counts,
    opening: analysis.opening_name ? { eco: analysis.opening_eco, name: analysis.opening_name } : null,
  };

  const sys = systemPrompt(audience, language) + text.jsonHard;
  const task = `FACTS:\n${JSON.stringify(facts, null, 2)}\n\n${text.taskSummary}`;

  try {
    const result = await chatJsonRetry<{ summary?: string; skill_assessment?: string; opening_prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: task },
    ], { temperature: 0.2, numPredict: 450, signal });
    return {
      summary: (result.summary ?? '').trim() || fallbackSummary(userAcc, counts, language),
      skill_assessment: (result.skill_assessment ?? '').trim() || fallbackSkill(userElo, language),
      opening_prose: (result.opening_prose ?? '').trim() || (analysis.opening_name ? fallbackOpening(analysis.opening_name, language) : ''),
    };
  } catch {
    return {
      summary: fallbackSummary(userAcc, counts, language),
      skill_assessment: fallbackSkill(userElo, language),
      opening_prose: analysis.opening_name ? fallbackOpening(analysis.opening_name, language) : '',
    };
  }
}

function fallbackSummary(acc: number, counts: Record<Classification, number>, language: Language): string {
  return reviewText(language).fallbackSummary(acc.toFixed(1), counts.brilliant, counts.mistake, counts.blunder);
}
function fallbackSkill(elo: number | null, language: Language): string {
  const text = reviewText(language);
  return elo == null ? text.fallbackSkillNone : text.fallbackSkill(elo);
}
function fallbackOpening(name: string, language: Language): string {
  return reviewText(language).fallbackOpening(name);
}

/** Build the full Game Review. Emits onProgress events as steps complete. */
export async function buildGameReview(args: BuildReviewArgs): Promise<GameReview> {
  const total = totalSteps(args);
  let done = 0;
  const fire = (step: ProgressEvent['step'], extra?: Partial<ProgressEvent>) => {
    args.onProgress?.({ step, done, total, ...(extra as object) } as ProgressEvent);
  };

  // Step 1: opening (already in analysis — local lookup)
  done++;
  fire('opening' as ProgressEvent['step']);

  const phases: GameReview['phases'] = { opening: null, middlegame: null, endgame: null };
  const phaseSplit = args.analysis.phase_split;
  if (phaseSplit?.opening) {
    phases.opening = await callPhase('opening', phaseSplit.opening, args.analysis.moves, args.language, args.audience, args.userColor, args.signal);
    done++; fire('phase:opening');
  }
  if (phaseSplit?.middlegame) {
    phases.middlegame = await callPhase('middlegame', phaseSplit.middlegame, args.analysis.moves, args.language, args.audience, args.userColor, args.signal);
    done++; fire('phase:middlegame');
  }
  if (phaseSplit?.endgame) {
    phases.endgame = await callPhase('endgame', phaseSplit.endgame, args.analysis.moves, args.language, args.audience, args.userColor, args.signal);
    done++; fire('phase:endgame');
  }

  const key_moments: KeyMomentProse[] = [];
  for (let i = 0; i < args.analysis.key_moments.length; i++) {
    const m = args.analysis.key_moments[i]!;
    const km = await callKeyMoment(m, args.language, args.audience, args.signal);
    key_moments.push(km);
    done++;
    args.onProgress?.({ step: 'moment', index: i, done, total });
  }

  const final = await callSummary(args.analysis, args.userColor, args.language, args.audience, args.signal);
  done++; fire('summary');

  return {
    version: REVIEW_PROSE_VERSION,
    language: args.language,
    audience: args.audience,
    opening: args.analysis.opening_name && args.analysis.opening_eco
      ? { eco: args.analysis.opening_eco, name: args.analysis.opening_name, prose: final.opening_prose }
      : null,
    summary: final.summary,
    skill_assessment: final.skill_assessment,
    phases,
    key_moments,
  };
}

/** Lightweight signature so callers can validate cached prose still matches the
 *  current language/audience/version before re-using it. */
export function reviewCacheKey(args: { language: Language; audience: Audience }): string {
  return `${REVIEW_PROSE_VERSION}|${args.language}|${args.audience}`;
}
