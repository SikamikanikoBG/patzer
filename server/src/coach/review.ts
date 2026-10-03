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
// v4 (whose move, and something to say):
// - Every move in FACTS says who played it. A key moment that was the
//   opponent's move is described as the opponent's — what it gave the player
//   and whether they took the chance — never as "you played …".
// - Key moments get the coach's deterministic facts (coaching.ts): what the
//   move allowed, the best answer to it, the better move and what it does.
// - The summary gets the story of the game instead of bare numbers: the
//   result, the turning point, the player's costliest moves with the better
//   ones, their best finds, the opponent's gifts, the weakest phase. The task
//   forbids re-stating accuracy/Elo (the page already shows them).
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
import { explainCoaching } from './coaching.js';
import { cpToWinPct } from '../chess/classifier.js';
import type { AnalysisResult, AnalyzedMove, Audience, Classification, GamePhase, KeyMomentSummary, Language } from '../types.js';

// Bump on every output-shape or prompt change so cached prose at the old
// version is invalidated.
// v2 = chess.com parity pass.
// v3 = anti-hallucination FACTS pass: piece inventory + win-prob in key moments.
// v4 = whose move it was; coaching facts in key moments; a summary with content.
export const REVIEW_PROSE_VERSION = 4;

// JSON-mode rule append-on. R10 in the consolidated 10-rule scheme. We use
// "R10:" numbering to extend prompts.ts's existing rule block cleanly.
//
// Every language-dependent string in this file lives in REVIEW_TEXT so adding
// a language is one table entry (same pattern as prompts.ts).
interface ReviewText {
  jsonHard: string;
  perspective: string;
  /** How FACTS names the mover: the player ("you") or their opponent. */
  you: string;
  opponent: string;
  result: Record<'win' | 'loss' | 'draw', string>;
  phase: Record<GamePhase, string>;
  keyMoment: string;
  taskPhase: (phase: string) => string;
  taskMomentOwn: string;
  taskMomentOpponent: string;
  taskSummary: string;
  fallbackPhase: (phase: string, accuracy: string, plies: number) => string;
  fallbackMoment: (move: number, verdict: string, cpLoss: number) => string;
  fallbackMomentOpponent: (move: number, verdict: string) => string;
  fallbackSummary: (acc: string, brilliant: number, mistakes: number, blunders: number) => string;
  fallbackSkillNone: string;
  fallbackSkill: (elo: number) => string;
  fallbackOpening: (name: string) => string;
}

const MOMENT_SCHEMA = `Schema: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`;

const REVIEW_TEXT: Record<Language, ReviewText> = {
  en: {
    jsonHard: `\n\nR10. Reply with EXACTLY ONE JSON object matching the schema in TASK. No prose outside the JSON. No markdown fences. No extra keys.`,
    perspective: 'you',
    you: 'you',
    opponent: 'the opponent',
    result: { win: 'you won', loss: 'you lost', draw: 'draw' },
    phase: { opening: 'opening', middlegame: 'middlegame', endgame: 'endgame' },
    keyMoment: 'Key moment',
    taskPhase: (phase) => `TASK: Describe how the player played the ${phase}, in 2-4 sentences, addressing them as "you".
- Moves in FACTS.moves with "by": "you" are the player's; "by": "the opponent" are the opponent's. Never call an opponent's move the player's.
- Name the concrete moves from FACTS.moves that mattered (in words, as given) and what they did — the good ones and the costly ones.
- End with one concrete thing to do better in this phase, based on FACTS.
- Do not repeat the accuracy number; the player already sees it.
Schema: { "prose": string }`,
    taskMomentOwn: `TASK: This key moment was the PLAYER's own move ("you"). Coach it. Slots:
- title: ≤6 words, no period at the end.
- what_happened: 1-2 sentences — what you played and what it did or allowed, using FACTS.moment.why and FACTS.moment.best_reply.
- why_it_matters: 1-2 sentences — the better move from FACTS.moment.better_move and what it would have achieved (or, for a good move, why it worked).
- what_to_learn: 1 sentence — the takeaway (FACTS.moment.takeaway if present).
${MOMENT_SCHEMA}`,
    taskMomentOpponent: `TASK: This key moment was the OPPONENT's move, not the player's. Never write "you played" about it. Slots:
- title: ≤6 words, no period at the end, about the opponent's move.
- what_happened: 1-2 sentences — what the opponent played and the verdict.
- why_it_matters: 1-2 sentences — what it meant for you: the chance it gave you (FACTS.moment.best_reply is how to punish it), and whether your answer (FACTS.moment.your_answer) took that chance.
- what_to_learn: 1 sentence — what to look for when the opponent does this.
${MOMENT_SCHEMA}`,
    taskSummary: `TASK: Write the coach's summary of this game for the player ("you"). Tell the story with the concrete facts:
- how the game was decided — FACTS.turning_point, naming the move in words and who played it;
- one thing you did well (FACTS.your_best_moves) and the most important thing to fix (FACTS.your_costliest_moves, with the better move);
- if FACTS.opponent_gifts is not empty, whether you used those chances.
Do NOT restate accuracy percentages, Elo or the classification counts — the player already sees them. No empty phrases like "control the tempo" or "fight for the initiative" unless FACTS backs them up.
Schema: { "summary": string (3-5 sentences), "skill_assessment": string (1 sentence: what this game shows about your level and the one habit that would lift it), "opening_prose": string (≤2 sentences on the opening) }`,
    fallbackPhase: (phase, accuracy, plies) => `Your ${phase} accuracy was ${accuracy}% across ${plies} plies.`,
    fallbackMoment: (move, verdict, cpLoss) => `On move ${move} the game turned: ${verdict}. The cost was about ${(cpLoss / 100).toFixed(1)} pawns.`,
    fallbackMomentOpponent: (move, verdict) => `On move ${move} the opponent played ${verdict}.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `Your accuracy was ${acc}%. You had ${brilliant} brilliant moves, ${mistakes} mistakes, and ${blunders} blunders.`,
    fallbackSkillNone: 'No skill estimate yet.',
    fallbackSkill: (elo) => `This game played at roughly ${elo} Elo.`,
    fallbackOpening: (name) => `You opened with ${name} — a solid choice.`,
  },
  bg: {
    jsonHard: `\n\nR10. Отговори с ТОЧНО ЕДИН JSON обект според схемата в TASK. Без текст извън JSON. Без markdown. Без допълнителни ключове.`,
    perspective: 'ти',
    you: 'ти',
    opponent: 'противникът',
    result: { win: 'ти спечели', loss: 'ти загуби', draw: 'реми' },
    phase: { opening: 'дебют', middlegame: 'мителшпил', endgame: 'ендшпил' },
    keyMoment: 'Ключов момент',
    taskPhase: (phase) => `TASK: Опиши как играчът изигра фазата ${phase} в 2-4 изречения, като се обръщаш към него с "ти".
- Ходовете във FACTS.moves с "by": "ти" са на играча; с "by": "противникът" са на противника. Никога не приписвай ход на противника на играча.
- Назови конкретните ходове от FACTS.moves, които имаха значение (с думи, както са дадени), и какво направиха — и добрите, и скъпите.
- Завърши с едно конкретно нещо, което да подобри в тази фаза, според FACTS.
- Не повтаряй процента точност; играчът вече го вижда.
Схема: { "prose": string }`,
    taskMomentOwn: `TASK: Този ключов момент е ход на САМИЯ играч ("ти"). Коучвай го. Слотове:
- title: ≤6 думи, без точка в края.
- what_happened: 1-2 изречения — какво изигра ти и какво направи или допусна ходът, по FACTS.moment.why и FACTS.moment.best_reply.
- why_it_matters: 1-2 изречения — по-добрият ход от FACTS.moment.better_move и какво щеше да постигне (или, при добър ход, защо проработи).
- what_to_learn: 1 изречение — изводът (FACTS.moment.takeaway, ако го има).
Схема: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskMomentOpponent: `TASK: Този ключов момент е ход на ПРОТИВНИКА, не на играча. Никога не пиши "ти изигра" за него. Слотове:
- title: ≤6 думи, без точка в края, за хода на противника.
- what_happened: 1-2 изречения — какво изигра противникът и оценката на хода.
- why_it_matters: 1-2 изречения — какво означаваше това за теб: шансът, който ти даде (FACTS.moment.best_reply е как се наказва), и дали твоят отговор (FACTS.moment.your_answer) го използва.
- what_to_learn: 1 изречение — какво да търсиш, когато противникът направи такова нещо.
Схема: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskSummary: `TASK: Напиши обобщението на треньора за тази партия към играча ("ти"). Разкажи историята с конкретните факти:
- как се реши партията — FACTS.turning_point, с назоваване на хода с думи и кой го изигра;
- едно нещо, което направи добре (FACTS.your_best_moves), и най-важното за поправяне (FACTS.your_costliest_moves, с по-добрия ход);
- ако FACTS.opponent_gifts не е празно — дали използва тези шансове.
НЕ повтаряй проценти точност, Elo или броя ходове по категории — играчът вече ги вижда. Без празни фрази като "контролираш темпото" или "борба за инициатива", освен ако FACTS ги подкрепя.
Схема: { "summary": string (3-5 изречения), "skill_assessment": string (1 изречение: какво показва партията за нивото ти и единственият навик, който би го вдигнал), "opening_prose": string (≤2 изречения за дебюта) }`,
    fallbackPhase: (phase, accuracy, plies) => `Във фазата ${phase} точността ти беше ${accuracy}% за ${plies} полу-хода.`,
    fallbackMoment: (move, verdict, cpLoss) => `На ход ${move} играта се обърна: ${verdict}. Загубата беше около ${(cpLoss / 100).toFixed(1)} пешки.`,
    fallbackMomentOpponent: (move, verdict) => `На ход ${move} противникът изигра ${verdict}.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `Точността ти беше ${acc}%. Имаше ${brilliant} брилянтни, ${mistakes} грешки и ${blunders} блъндера.`,
    fallbackSkillNone: 'Все още нямаме оценка на нивото.',
    fallbackSkill: (elo) => `Партията ти изглежда на ниво около ${elo} Elo.`,
    fallbackOpening: (name) => `Започна с ${name} — солиден избор.`,
  },
  es: {
    jsonHard: `\n\nR10. Responde con EXACTAMENTE UN objeto JSON que siga el esquema de TASK. Sin texto fuera del JSON. Sin bloques markdown. Sin claves adicionales.`,
    perspective: 'tú',
    you: 'tú',
    opponent: 'el rival',
    result: { win: 'ganaste', loss: 'perdiste', draw: 'tablas' },
    phase: { opening: 'apertura', middlegame: 'medio juego', endgame: 'final' },
    keyMoment: 'Momento clave',
    taskPhase: (phase) => `TASK: Describe cómo jugó el jugador la ${phase}, en 2-4 frases, tratándolo de "tú".
- Las jugadas de FACTS.moves con "by": "tú" son del jugador; con "by": "el rival", del rival. Nunca atribuyas al jugador una jugada del rival.
- Nombra las jugadas concretas de FACTS.moves que importaron (en palabras, tal como vienen) y qué hicieron: las buenas y las costosas.
- Termina con una cosa concreta que mejorar en esta fase, según FACTS.
- No repitas el porcentaje de precisión; el jugador ya lo ve.
Esquema: { "prose": string }`,
    taskMomentOwn: `TASK: Este momento clave fue una jugada del PROPIO jugador ("tú"). Entrénalo. Campos:
- title: ≤6 palabras, sin punto final.
- what_happened: 1-2 frases — qué jugaste y qué hizo o permitió, con FACTS.moment.why y FACTS.moment.best_reply.
- why_it_matters: 1-2 frases — la jugada mejor de FACTS.moment.better_move y qué habría logrado (o, si fue buena, por qué funcionó).
- what_to_learn: 1 frase — la lección (FACTS.moment.takeaway si existe).
Esquema: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskMomentOpponent: `TASK: Este momento clave fue una jugada del RIVAL, no del jugador. Nunca escribas "jugaste" sobre ella. Campos:
- title: ≤6 palabras, sin punto final, sobre la jugada del rival.
- what_happened: 1-2 frases — qué jugó el rival y el veredicto.
- why_it_matters: 1-2 frases — qué significó para ti: la oportunidad que te dio (FACTS.moment.best_reply es cómo castigarla) y si tu respuesta (FACTS.moment.your_answer) la aprovechó.
- what_to_learn: 1 frase — qué buscar cuando el rival hace algo así.
Esquema: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskSummary: `TASK: Escribe el resumen del entrenador de esta partida para el jugador ("tú"). Cuenta la historia con los hechos concretos:
- cómo se decidió la partida — FACTS.turning_point, nombrando la jugada en palabras y quién la jugó;
- una cosa que hiciste bien (FACTS.your_best_moves) y lo más importante que corregir (FACTS.your_costliest_moves, con la jugada mejor);
- si FACTS.opponent_gifts no está vacío, si aprovechaste esas oportunidades.
NO repitas porcentajes de precisión, Elo ni los recuentos por categoría: el jugador ya los ve. Sin frases vacías como "controlas el ritmo" o "la lucha por la iniciativa" salvo que FACTS lo respalde.
Esquema: { "summary": string (3-5 frases), "skill_assessment": string (1 frase: qué muestra esta partida de tu nivel y el hábito que lo subiría), "opening_prose": string (≤2 frases sobre la apertura) }`,
    fallbackPhase: (phase, accuracy, plies) => `Tu precisión en la ${phase} fue del ${accuracy}% en ${plies} medias jugadas.`,
    fallbackMoment: (move, verdict, cpLoss) => `En la jugada ${move} la partida cambió: ${verdict}. El coste fue de unos ${(cpLoss / 100).toFixed(1)} peones.`,
    fallbackMomentOpponent: (move, verdict) => `En la jugada ${move} el rival jugó ${verdict}.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `Tu precisión fue del ${acc}%. Tuviste ${brilliant} jugadas brillantes, ${mistakes} errores y ${blunders} errores graves.`,
    fallbackSkillNone: 'Aún no hay una estimación de nivel.',
    fallbackSkill: (elo) => `Esta partida se jugó a un nivel de unos ${elo} Elo.`,
    fallbackOpening: (name) => `Abriste con ${name}: una elección sólida.`,
  },
  de: {
    jsonHard: `\n\nR10. Antworte mit GENAU EINEM JSON-Objekt nach dem Schema in TASK. Kein Text außerhalb des JSON. Keine Markdown-Codeblöcke. Keine zusätzlichen Schlüssel.`,
    perspective: 'du',
    you: 'du',
    opponent: 'der Gegner',
    result: { win: 'du hast gewonnen', loss: 'du hast verloren', draw: 'remis' },
    phase: { opening: 'Eröffnung', middlegame: 'Mittelspiel', endgame: 'Endspiel' },
    keyMoment: 'Schlüsselmoment',
    taskPhase: (phase) => `TASK: Beschreibe in 2-4 Sätzen, wie der Spieler die Phase „${phase}“ gespielt hat. Duze ihn, aber ohne Begrüßung und ohne "du" als Anrede.
- Züge in FACTS.moves mit "by": "du" sind die des Spielers; mit "by": "der Gegner" die des Gegners. Schreib nie einen Zug des Gegners dem Spieler zu.
- Nenne die konkreten Züge aus FACTS.moves, die zählten (in Worten, wie angegeben), und was sie bewirkt haben — die guten und die teuren.
- Schließe mit einer konkreten Sache, die in dieser Phase besser gehen sollte, laut FACTS.
- Wiederhole die Genauigkeit nicht; der Spieler sieht sie schon.
Schema: { "prose": string }`,
    taskMomentOwn: `TASK: Dieser Schlüsselmoment war ein Zug des Spielers SELBST ("du"). Coache ihn. Duze ihn, aber ohne Begrüßung und ohne "du" als Anrede. Felder:
- title: ≤6 Wörter, kein Punkt am Ende.
- what_happened: 1-2 Sätze — was gespielt wurde und was der Zug bewirkt oder erlaubt hat, mit FACTS.moment.why und FACTS.moment.best_reply.
- why_it_matters: 1-2 Sätze — der bessere Zug aus FACTS.moment.better_move und was er erreicht hätte (oder, bei einem guten Zug, warum er funktioniert hat).
- what_to_learn: 1 Satz — die Lehre (FACTS.moment.takeaway, falls vorhanden).
Schema: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskMomentOpponent: `TASK: Dieser Schlüsselmoment war ein Zug des GEGNERS, nicht des Spielers. Schreib nie "du hast gespielt" darüber. Felder:
- title: ≤6 Wörter, kein Punkt am Ende, über den Zug des Gegners.
- what_happened: 1-2 Sätze — was der Gegner gespielt hat und das Urteil.
- why_it_matters: 1-2 Sätze — was es für dich bedeutete: die Chance, die es dir gab (FACTS.moment.best_reply zeigt, wie man es bestraft), und ob deine Antwort (FACTS.moment.your_answer) sie genutzt hat.
- what_to_learn: 1 Satz — worauf du achten solltest, wenn der Gegner so etwas spielt.
Schema: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskSummary: `TASK: Schreib die Zusammenfassung des Trainers zu dieser Partie für den Spieler. Duze ihn, aber ohne Begrüßung und ohne "du" als Anrede. Erzähl die Geschichte mit den konkreten Fakten:
- wie die Partie entschieden wurde — FACTS.turning_point, mit dem Zug in Worten und wer ihn gespielt hat;
- eine Sache, die gut war (FACTS.your_best_moves), und das Wichtigste zum Verbessern (FACTS.your_costliest_moves, mit dem besseren Zug);
- wenn FACTS.opponent_gifts nicht leer ist: ob diese Chancen genutzt wurden.
Wiederhole KEINE Genauigkeitswerte, Elo oder Zählungen nach Kategorie — der Spieler sieht sie schon. Keine leeren Phrasen wie "das Tempo kontrollieren" oder "Kampf um die Initiative", außer FACTS stützt sie.
Schema: { "summary": string (3-5 Sätze), "skill_assessment": string (1 Satz: was die Partie über die Spielstärke zeigt und die eine Gewohnheit, die sie heben würde), "opening_prose": string (≤2 Sätze zur Eröffnung) }`,
    fallbackPhase: (phase, accuracy, plies) => `In der Phase „${phase}“ lag deine Genauigkeit bei ${accuracy} % über ${plies} Halbzüge.`,
    fallbackMoment: (move, verdict, cpLoss) => `Im ${move}. Zug kippte die Partie: ${verdict}. Das kostete etwa ${(cpLoss / 100).toFixed(1)} Bauern.`,
    fallbackMomentOpponent: (move, verdict) => `Im ${move}. Zug spielte der Gegner ${verdict}.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `Deine Genauigkeit lag bei ${acc} %. Du hattest ${brilliant} brillante Züge, ${mistakes} Fehler und ${blunders} Patzer.`,
    fallbackSkillNone: 'Noch keine Einschätzung der Spielstärke.',
    fallbackSkill: (elo) => `Diese Partie entsprach etwa ${elo} Elo.`,
    fallbackOpening: (name) => `Du hast mit ${name} eröffnet — eine solide Wahl.`,
  },
  ru: {
    jsonHard: `\n\nR10. Ответь РОВНО ОДНИМ JSON-объектом по схеме из TASK. Без текста вне JSON. Без markdown-блоков. Без лишних ключей.`,
    perspective: 'ты',
    you: 'ты',
    opponent: 'соперник',
    result: { win: 'ты выиграл', loss: 'ты проиграл', draw: 'ничья' },
    phase: { opening: 'дебют', middlegame: 'миттельшпиль', endgame: 'эндшпиль' },
    keyMoment: 'Ключевой момент',
    taskPhase: (phase) => `TASK: Опиши в 2-4 предложениях, как игрок провёл стадию «${phase}». Обращайся на "ты", без глаголов прошедшего времени с родом.
- Ходы в FACTS.moves с "by": "ты" — ходы игрока; с "by": "соперник" — ходы соперника. Никогда не приписывай игроку ход соперника.
- Назови конкретные ходы из FACTS.moves, которые имели значение (словами, как даны), и что они сделали — и удачные, и дорогие.
- Закончи одной конкретной вещью, которую стоит улучшить в этой стадии, по FACTS.
- Не повторяй процент точности: игрок его уже видит.
Схема: { "prose": string }`,
    taskMomentOwn: `TASK: Этот ключевой момент — ход САМОГО игрока ("ты"). Разбери его как тренер. Обращайся на "ты", без глаголов прошедшего времени с родом. Поля:
- title: ≤6 слов, без точки в конце.
- what_happened: 1-2 предложения — что сыграно и что ход сделал или допустил, по FACTS.moment.why и FACTS.moment.best_reply.
- why_it_matters: 1-2 предложения — лучший ход из FACTS.moment.better_move и чего бы он добился (или, если ход хороший, почему он сработал).
- what_to_learn: 1 предложение — вывод (FACTS.moment.takeaway, если есть).
Схема: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskMomentOpponent: `TASK: Этот ключевой момент — ход СОПЕРНИКА, а не игрока. Никогда не пиши о нём "ты сыграл". Поля:
- title: ≤6 слов, без точки в конце, о ходе соперника.
- what_happened: 1-2 предложения — что сыграл соперник и вердикт.
- why_it_matters: 1-2 предложения — что это значило для тебя: шанс, который он дал (FACTS.moment.best_reply — как его наказать), и использовал ли его твой ответ (FACTS.moment.your_answer).
- what_to_learn: 1 предложение — на что смотреть, когда соперник так делает.
Схема: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskSummary: `TASK: Напиши итог тренера по этой партии для игрока ("ты"), без глаголов прошедшего времени с родом. Расскажи историю на конкретных фактах:
- как решилась партия — FACTS.turning_point, назови ход словами и кто его сделал;
- одна удачная вещь (FACTS.your_best_moves) и самое важное, что исправить (FACTS.your_costliest_moves, с лучшим ходом);
- если FACTS.opponent_gifts не пуст — использованы ли эти шансы.
НЕ повторяй проценты точности, Эло и количество ходов по категориям — игрок их уже видит. Без пустых фраз вроде "контроль темпа" или "борьба за инициативу", если FACTS этого не подтверждает.
Схема: { "summary": string (3-5 предложений), "skill_assessment": string (1 предложение: что партия говорит об уровне и какая одна привычка его поднимет), "opening_prose": string (≤2 предложения о дебюте) }`,
    fallbackPhase: (phase, accuracy, plies) => `В стадии «${phase}» твоя точность — ${accuracy}% на ${plies} полуходах.`,
    fallbackMoment: (move, verdict, cpLoss) => `На ${move}-м ходу партия перевернулась: ${verdict}. Цена — около ${(cpLoss / 100).toFixed(1)} пешки.`,
    fallbackMomentOpponent: (move, verdict) => `На ${move}-м ходу соперник сыграл: ${verdict}.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `Твоя точность — ${acc}%. Блестящих ходов: ${brilliant}, ошибок: ${mistakes}, зевков: ${blunders}.`,
    fallbackSkillNone: 'Оценки уровня пока нет.',
    fallbackSkill: (elo) => `Эта партия сыграна примерно на уровне ${elo} Эло.`,
    fallbackOpening: (name) => `Дебют партии — ${name}: крепкий выбор.`,
  },
  fa: {
    jsonHard: `\n\nR10. دقیقاً با یک شیء JSON مطابق طرح TASK پاسخ بده. هیچ متنی بیرون از JSON نباشد. بدون بلوک markdown. بدون کلید اضافه.`,
    perspective: 'تو',
    you: 'تو',
    opponent: 'حریف',
    result: { win: 'تو بردی', loss: 'تو باختی', draw: 'مساوی' },
    phase: { opening: 'گشایش', middlegame: 'وسط بازی', endgame: 'آخر بازی' },
    keyMoment: 'لحظهٔ کلیدی',
    taskPhase: (phase) => `TASK: در ۲ تا ۴ جمله توضیح بده بازیکن مرحلهٔ «${phase}» را چطور بازی کرد. او را «تو» خطاب کن.
- حرکت‌های FACTS.moves با "by": "تو" حرکت‌های بازیکن‌اند؛ با "by": "حریف" حرکت‌های حریف. هرگز حرکت حریف را به بازیکن نسبت نده.
- حرکت‌های مشخصی از FACTS.moves را که مهم بودند نام ببر (با کلمات، همان‌طور که آمده‌اند) و بگو چه کردند — هم خوب‌ها و هم پرهزینه‌ها.
- با یک کار مشخص که در این مرحله باید بهتر شود تمام کن، بر پایهٔ FACTS.
- عدد دقت را تکرار نکن؛ بازیکن خودش آن را می‌بیند.
طرح: { "prose": string }`,
    taskMomentOwn: `TASK: این لحظهٔ کلیدی حرکت خودِ بازیکن («تو») بود. مثل مربی درباره‌اش حرف بزن. فیلدها:
- title: حداکثر ۶ کلمه، بدون نقطه در پایان.
- what_happened: ۱ تا ۲ جمله — چه بازی کردی و آن حرکت چه کرد یا چه اجازه‌ای داد، با FACTS.moment.why و FACTS.moment.best_reply.
- why_it_matters: ۱ تا ۲ جمله — حرکت بهتر از FACTS.moment.better_move و اینکه چه به دست می‌آورد (یا اگر حرکت خوب بود، چرا جواب داد).
- what_to_learn: ۱ جمله — درسی که باید گرفت (FACTS.moment.takeaway اگر هست).
طرح: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskMomentOpponent: `TASK: این لحظهٔ کلیدی حرکت حریف بود، نه بازیکن. هرگز درباره‌اش ننویس «تو بازی کردی». فیلدها:
- title: حداکثر ۶ کلمه، بدون نقطه در پایان، دربارهٔ حرکت حریف.
- what_happened: ۱ تا ۲ جمله — حریف چه بازی کرد و حکم آن چه بود.
- why_it_matters: ۱ تا ۲ جمله — برای تو چه معنایی داشت: فرصتی که به تو داد (FACTS.moment.best_reply راه تنبیه آن است)، و اینکه جواب تو (FACTS.moment.your_answer) از آن فرصت استفاده کرد یا نه.
- what_to_learn: ۱ جمله — وقتی حریف چنین کاری می‌کند دنبال چه بگردی.
طرح: { "title": string, "what_happened": string, "why_it_matters": string, "what_to_learn": string }`,
    taskSummary: `TASK: جمع‌بندی مربی از این بازی را برای بازیکن («تو») بنویس. داستان بازی را با واقعیت‌های مشخص تعریف کن:
- بازی چطور تعیین شد — FACTS.turning_point، با نام بردن حرکت به کلمات و اینکه چه کسی آن را بازی کرد؛
- یک کاری که خوب انجام دادی (FACTS.your_best_moves) و مهم‌ترین چیزی که باید درست شود (FACTS.your_costliest_moves، همراه حرکت بهتر)؛
- اگر FACTS.opponent_gifts خالی نیست، اینکه از آن فرصت‌ها استفاده کردی یا نه.
درصد دقت، الو یا تعداد حرکت‌ها در هر دسته را تکرار نکن — بازیکن خودش آن‌ها را می‌بیند. جمله‌های توخالی مثل «کنترل تمپو» یا «نبرد برای ابتکار عمل» ننویس، مگر اینکه FACTS پشتشان باشد.
طرح: { "summary": string (۳ تا ۵ جمله), "skill_assessment": string (۱ جمله: این بازی دربارهٔ سطح تو چه نشان می‌دهد و آن یک عادتی که سطحت را بالا می‌برد), "opening_prose": string (حداکثر ۲ جمله دربارهٔ گشایش) }`,
    fallbackPhase: (phase, accuracy, plies) => `دقت تو در مرحلهٔ «${phase}» در ${plies} نیم‌حرکت ${accuracy}% بود.`,
    fallbackMoment: (move, verdict, cpLoss) => `در حرکت ${move} ورق بازی برگشت: ${verdict}. هزینه‌اش حدود ${(cpLoss / 100).toFixed(1)} سرباز بود.`,
    fallbackMomentOpponent: (move, verdict) => `در حرکت ${move} حریف این را بازی کرد: ${verdict}.`,
    fallbackSummary: (acc, brilliant, mistakes, blunders) => `دقت تو ${acc}% بود. ${brilliant} حرکت درخشان، ${mistakes} اشتباه و ${blunders} اشتباه فاحش داشتی.`,
    fallbackSkillNone: 'هنوز برآوردی از سطح بازی نیست.',
    fallbackSkill: (elo) => `این بازی تقریباً در سطح ${elo} الو انجام شد.`,
    fallbackOpening: (name) => `بازی را با ${name} شروع کردی — انتخابی محکم.`,
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
  /** Whether the move was the player's own (false: the opponent's). */
  by_user: boolean;
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
  /** The player, for the coach's memory of their past games (optional). */
  userId?: number;
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

const sideOf = (ply: number): 'white' | 'black' => (ply % 2 === 1 ? 'white' : 'black');
const moveNumber = (ply: number) => Math.ceil(ply / 2);

/** Win chance (0-100) before and after a move, for the side that played it. */
function moverWinPct(m: Pick<AnalyzedMove, 'ply' | 'eval_before_cp' | 'eval_after_cp'>): { before: number; after: number } {
  const white = sideOf(m.ply) === 'white';
  const pov = (cp: number | null) => (white ? cpToWinPct(cp ?? 0) : 100 - cpToWinPct(cp ?? 0));
  return { before: Math.round(pov(m.eval_before_cp)), after: Math.round(pov(m.eval_after_cp)) };
}

const BAD: Classification[] = ['inaccuracy', 'mistake', 'blunder', 'miss'];
const COSTLY: Classification[] = ['mistake', 'blunder', 'miss'];

/** One move in words for FACTS, with who played it. */
function describeMove(m: AnalyzedMove, userColor: 'white' | 'black', language: Language, audience: Audience) {
  const text = reviewText(language);
  const better = m.best_move_san && m.best_move_san !== m.san ? sanToNatural(m.best_move_san, m.fen_before, language, audience) : null;
  return {
    move_number: moveNumber(m.ply),
    by: sideOf(m.ply) === userColor ? text.you : text.opponent,
    played: sanToNatural(m.san, m.fen_before, language, audience),
    verdict: verdictPhrase(m.classification, language),
    ...(better && BAD.includes(m.classification) ? { better_move: better } : {}),
  };
}

/** "1-0" / "0-1" / "1/2-1/2" from the PGN's Result tag, from the player's side. */
function resultFor(pgn: string, userColor: 'white' | 'black'): 'win' | 'loss' | 'draw' | null {
  const r = /\[Result\s+"([^"]+)"\]/.exec(pgn)?.[1];
  if (r === '1/2-1/2') return 'draw';
  if (r === '1-0') return userColor === 'white' ? 'win' : 'loss';
  if (r === '0-1') return userColor === 'black' ? 'win' : 'loss';
  return null;
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
  const oppAcc = userColor === 'white' ? data.accuracy_black : data.accuracy_white;
  const text = reviewText(language);
  const phaseLabelLocal = text.phase[phase];
  const slice = moves.filter((m) => m.ply >= data.from_ply && m.ply <= data.to_ply);

  // The moves that tell the phase's story: the player's notable ones (good
  // finds and costly ones) and the opponent's bigger errors, in game order.
  const notable = (m: AnalyzedMove) => sideOf(m.ply) === userColor
    ? ['brilliant', 'great', ...BAD].includes(m.classification)
    : COSTLY.includes(m.classification);
  const interesting = slice.filter(notable).slice(0, 8).map((m) => describeMove(m, userColor, language, audience));

  const facts = {
    lang: language,
    audience,
    perspective: text.perspective,
    phase: phaseLabelLocal,
    your_accuracy: userAcc,
    opponent_accuracy: oppAcc,
    your_acpl: userAcpl,
    plies_in_phase: slice.length,
    moves: interesting,
  };

  const sys = systemPrompt(audience, language) + text.jsonHard;
  const task = `FACTS:\n${JSON.stringify(facts, null, 2)}\n\n${text.taskPhase(phaseLabelLocal)}`;

  try {
    const result = await chatJsonRetry<{ prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: task },
    ], { temperature: 0.2, numPredict: 450, signal });
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

/** The FACTS for one key moment. Exported for tests. */
export async function keyMomentFacts(
  moment: KeyMomentSummary,
  moves: AnalyzedMove[],
  userColor: 'white' | 'black',
  language: Language,
  audience: Audience,
  userId?: number,
) {
  const text = reviewText(language);
  const byUser = moment.side === userColor;
  const played = sanToNatural(moment.san, moment.fen_before, language, audience);
  const best = moment.best_san && moment.best_san !== moment.san ? sanToNatural(moment.best_san, moment.fen_before, language, audience) : null;
  const pv = pvToNaturalSan(moment.best_pv, moment.fen_before, language, audience, 3);
  // Piece inventory from the PLAYER's side, whoever moved — "your pieces"
  // must always be the player's.
  const board = boardPiecesNatural(moment.fen_before, userColor, language, audience);
  const move = moves.find((m) => m.ply === moment.ply);
  const wp = move ? moverWinPct(move) : null;

  // The coach's deterministic facts: what the move did or allowed, the best
  // answer to it, the better move and what that does. Engine-backed; if the
  // engine isn't there it still answers from chess.js alone.
  const coaching = await explainCoaching({
    fen: moment.fen_before,
    played_san: moment.san,
    best_san: moment.best_san,
    classification: moment.classification,
    userId: userId ?? 0,
    ownMove: byUser && userId != null,
  }, language, audience).catch(() => null);
  const c = coaching?.facts ?? {};

  // For the opponent's move: how the player answered it.
  const next = byUser ? null : moves.find((m) => m.ply === moment.ply + 1);
  const yourAnswer = next ? {
    played: sanToNatural(next.san, next.fen_before, language, audience),
    verdict: verdictPhrase(next.classification, language),
    ...(next.best_move_san && next.best_move_san !== next.san ? { better_was: sanToNatural(next.best_move_san, next.fen_before, language, audience) } : {}),
  } : null;

  return {
    lang: language,
    audience,
    perspective: text.perspective,
    moment: {
      move_number: moveNumber(moment.ply),
      who_moved: byUser ? text.you : text.opponent,
      tone: (c.tone as string | undefined) ?? null,
      played,
      verdict: verdictPhrase(moment.classification, language),
      win_pct_before: wp?.before ?? null,
      win_pct_after: wp?.after ?? null,
      why: (c.why as string[] | undefined) ?? [],
      // The strongest answer to the move that was played.
      best_reply: (c.opponent_reply as string | null | undefined) ?? null,
      better_move: (c.better_move as string | null | undefined) ?? best,
      engine_pv: pv,
      takeaway: byUser ? ((c.takeaway as string | null | undefined) ?? null) : null,
      ...(yourAnswer ? { your_answer: yourAnswer } : {}),
      your_pieces: board.player,
      opponent_pieces: board.opponent,
    },
  };
}

async function callKeyMoment(
  moment: KeyMomentSummary,
  moves: AnalyzedMove[],
  args: BuildReviewArgs,
): Promise<KeyMomentProse> {
  const { language, audience, userColor, signal } = args;
  const text = reviewText(language);
  const byUser = moment.side === userColor;
  try {
    const facts = await keyMomentFacts(moment, moves, userColor, language, audience, args.userId);
    const sys = systemPrompt(audience, language) + text.jsonHard;
    const task = `FACTS:\n${JSON.stringify(facts, null, 2)}\n\n${byUser ? text.taskMomentOwn : text.taskMomentOpponent}`;
    const result = await chatJsonRetry<{ title?: string; what_happened?: string; why_it_matters?: string; what_to_learn?: string; prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: task },
    ], { temperature: 0.2, numPredict: 500, signal });
    const title = (result.title ?? '').trim() || text.keyMoment;
    // Slot-fill OR legacy `prose` field — accept both for backward compat.
    const prose = result.prose?.trim() || joinSlots(result.what_happened, result.why_it_matters, result.what_to_learn) || fallbackMoment(moment, byUser, language);
    return { ...moment, title, prose, by_user: byUser };
  } catch {
    return { ...moment, title: text.keyMoment, prose: fallbackMoment(moment, byUser, language), by_user: byUser };
  }
}

function fallbackMoment(m: KeyMomentSummary, byUser: boolean, language: Language): string {
  const cls = verdictPhrase(m.classification, language);
  const text = reviewText(language);
  return byUser ? text.fallbackMoment(moveNumber(m.ply), cls, m.cp_loss) : text.fallbackMomentOpponent(moveNumber(m.ply), cls);
}

/** The FACTS for the summary. Exported for tests. */
export function summaryFacts(
  analysis: AnalysisResult,
  pgn: string,
  userColor: 'white' | 'black',
  language: Language,
  audience: Audience,
) {
  const text = reviewText(language);
  const userAcc = userColor === 'white' ? analysis.accuracy_white : analysis.accuracy_black;
  const oppAcc = userColor === 'white' ? analysis.accuracy_black : analysis.accuracy_white;
  const userElo = userColor === 'white' ? analysis.estimated_elo_white : analysis.estimated_elo_black;
  const counts: Record<Classification, number> = {
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0,
    forced: 0, inaccuracy: 0, mistake: 0, blunder: 0, miss: 0,
  };
  const mine = analysis.moves.filter((m) => sideOf(m.ply) === userColor);
  const theirs = analysis.moves.filter((m) => sideOf(m.ply) !== userColor);
  for (const m of mine) counts[m.classification]++;

  const swing = (m: AnalyzedMove) => { const w = moverWinPct(m); return w.before - w.after; };
  const describe = (m: AnalyzedMove) => describeMove(m, userColor, language, audience);

  // The turning point: the move that swung the win chance the most, either side.
  const turning = [...analysis.moves].filter((m) => BAD.includes(m.classification)).sort((a, b) => swing(b) - swing(a))[0];
  const costliest = mine.filter((m) => COSTLY.includes(m.classification) || (m.classification === 'inaccuracy' && swing(m) >= 8))
    .sort((a, b) => swing(b) - swing(a)).slice(0, 3)
    .map((m) => ({ ...describe(m), win_pct_before: moverWinPct(m).before, win_pct_after: moverWinPct(m).after }));
  const bestFinds = mine.filter((m) => m.classification === 'brilliant' || m.classification === 'great').slice(0, 2).map(describe);
  const gifts = theirs.filter((m) => COSTLY.includes(m.classification)).sort((a, b) => swing(b) - swing(a)).slice(0, 2).map((m) => {
    const answer = analysis.moves.find((x) => x.ply === m.ply + 1);
    return { ...describe(m), your_answer: answer ? describe(answer) : null };
  });

  // Phase accuracies from the player's side, and the weakest one.
  const phases: Partial<Record<GamePhase, { you: number; opponent: number }>> = {};
  for (const k of ['opening', 'middlegame', 'endgame'] as const) {
    const p = analysis.phase_split?.[k];
    if (p) phases[k] = userColor === 'white' ? { you: p.accuracy_white, opponent: p.accuracy_black } : { you: p.accuracy_black, opponent: p.accuracy_white };
  }
  const weakest = (Object.entries(phases) as [GamePhase, { you: number }][]).sort((a, b) => a[1].you - b[1].you)[0];
  const result = resultFor(pgn, userColor);

  return {
    facts: {
      lang: language,
      audience,
      perspective: text.perspective,
      result: result ? text.result[result] : null,
      opening: analysis.opening_name ? { eco: analysis.opening_eco, name: analysis.opening_name } : null,
      turning_point: turning ? describe(turning) : null,
      your_costliest_moves: costliest,
      your_best_moves: bestFinds,
      opponent_gifts: gifts,
      weakest_phase: weakest && Object.keys(phases).length > 1 ? text.phase[weakest[0]] : null,
      // Context only — the task says not to repeat these numbers.
      your_accuracy: userAcc,
      opponent_accuracy: oppAcc,
      estimated_elo: userElo,
      your_move_counts: counts,
    },
    counts,
    userAcc,
    userElo,
  };
}

async function callSummary(args: BuildReviewArgs): Promise<{ summary: string; skill_assessment: string; opening_prose: string }> {
  const { analysis, userColor, language, audience, signal } = args;
  const { facts, counts, userAcc, userElo } = summaryFacts(analysis, args.pgn, userColor, language, audience);
  const text = reviewText(language);
  const sys = systemPrompt(audience, language) + text.jsonHard;
  const task = `FACTS:\n${JSON.stringify(facts, null, 2)}\n\n${text.taskSummary}`;

  try {
    const result = await chatJsonRetry<{ summary?: string; skill_assessment?: string; opening_prose?: string }>([
      { role: 'system', content: sys },
      { role: 'user', content: task },
    ], { temperature: 0.2, numPredict: 600, signal });
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
    const km = await callKeyMoment(m, args.analysis.moves, args);
    key_moments.push(km);
    done++;
    args.onProgress?.({ step: 'moment', index: i, done, total });
  }

  const final = await callSummary(args);
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
