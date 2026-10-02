import { Chess } from "chess.js";
import { cpToWinPct } from "../chess/classifier.js";
import { createAnalysisEngine } from "../chess/engine.js";
import { hasBackRankSignature } from "../chess/phases.js";
import type { Audience, Classification, Language } from "../types.js";
import { pieceNames, ruPlural, verdictPhrase } from "./locales.js";
import { sanToNatural } from "./moves.js";
import { evaluationStateNatural } from "./facts-utils.js";
import { mistakeKind, missedInTrainer, playerMemory, weakestPhase, type MistakeKind, type PlayerMemory } from "./memory.js";
import { moveMotifs, positionFeatures, type MoveMotifs, type PieceRef } from "./tactics.js";

// What turns the coach from a narrator into a coach. For the move being
// explained it works out, before the LLM sees anything:
//   - WHY it was good or bad (what it allows, hangs, wins, stops),
//   - the opponent's best answer to it,
//   - the better move and the other good ones, each with what it achieves,
//   - a rule of thumb for that kind of mistake,
//   - how it fits the player's recent games (and the opening trainer),
//   - a concrete next step on the platform (a Learn lesson, puzzles).
// For a hint it works out where to look without giving the move away.
//
// All of it is deterministic — chess.js, Stockfish and the database — and
// rendered in the player's language. The LLM phrases and connects it; it
// never has to work anything out, which is what keeps small models honest.

// ─── Engine ─────────────────────────────────────────────────────────────────

export interface EngineLine { cp: number | null; mate: number | null; pv: string[] }
/** Top `n` lines for the side to move (cp/mate from White's point of view). */
export type CoachEngine = (fen: string, n: number) => Promise<EngineLine[] | null>;

const COACH_DEPTH = 12;
const COACH_ENGINE_TIMEOUT_MS = 6000;

const stockfishLines: CoachEngine = async (fen, n) => {
  const engine = createAnalysisEngine();
  let timer: NodeJS.Timeout | undefined;
  try {
    const run = (async () => {
      await engine.start();
      await engine.setOption("Threads", "1");
      await engine.setOption("Hash", "16");
      const r = await engine.evaluateMulti(fen, COACH_DEPTH, n);
      return r.candidates.map((c) => ({ cp: c.cp, mate: c.mate, pv: c.pv }));
    })();
    const timeout = new Promise<null>((res) => { timer = setTimeout(() => res(null), COACH_ENGINE_TIMEOUT_MS); });
    return await Promise.race([run, timeout]);
  } catch {
    // No engine (no Stockfish binary, hosted engine down): coach from
    // chess.js alone rather than not at all.
    return null;
  } finally {
    clearTimeout(timer);
    engine.quit().catch(() => {});
  }
};

let coachEngine: CoachEngine = stockfishLines;
/** Swap the engine — tests use a scripted one. Returns the previous one. */
export function setCoachEngine(e: CoachEngine): CoachEngine {
  const prev = coachEngine;
  coachEngine = e;
  return prev;
}

function uciToSan(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san;
  } catch {
    return null;
  }
}

/** An engine line (UCI) in words, stopping at the first move that won't play. */
function naturalLine(fen: string, pv: string[], max: number, lang: Language, aud: Audience): string[] {
  const out: string[] = [];
  let pos = fen;
  for (const uci of pv.slice(0, max)) {
    const san = uciToSan(pos, uci);
    if (!san) break;
    out.push(sanToNatural(san, pos, lang, aud));
    const c = new Chess(pos);
    c.move(san);
    pos = c.fen();
  }
  return out;
}

/** White-POV engine score → centipawns for the side that is to move in `fen`. */
function cpForMover(line: EngineLine, fen: string): number {
  const white = line.mate != null ? (line.mate > 0 ? 10000 : -10000) : (line.cp ?? 0);
  return fen.split(" ")[1] === "w" ? white : -white;
}

// ─── Phrases ────────────────────────────────────────────────────────────────

interface Phrases {
  on: string;
  allowsMate: (m: string) => string;
  hangs: (p: string) => string;
  opponentReply: (m: string) => string;
  reasons: {
    mate: string; stopsMate: string; threatensMate: string; check: string; castles: string; develops: string;
    wins: (p: string) => string; fork: (ps: string) => string; saves: (p: string) => string; threatens: (p: string) => string;
  };
  quiet: string;
  takeaway: Record<MistakeKind | "positional", string>;
  kind: Record<MistakeKind, string>;
  pattern: (n: number, total: number, label: string) => string;
  weakPhase: (weak: string, wa: number, best: string, ba: number) => string;
  phase: Record<"opening" | "middlegame" | "endgame", string>;
  greatFinds: (n: number) => string;
  trainer: (n: number, m: string) => string;
  hint: {
    mateAvailable: string; mateThreat: string; inCheck: string;
    ourHanging: (ps: string) => string; theirHanging: (ps: string) => string;
    undeveloped: (ps: string) => string; notCastled: string; topIdea: (r: string) => string;
  };
}

const PHRASES: Record<Language, Phrases> = {
  en: {
    on: "on",
    allowsMate: (m) => `This move lets the opponent checkmate at once: ${m}.`,
    hangs: (p) => `Left unprotected after this move: ${p}. The opponent can win material.`,
    opponentReply: (m) => `The opponent's best answer: ${m}.`,
    reasons: {
      mate: "it is checkmate", stopsMate: "it stops the checkmate threat", threatensMate: "it threatens checkmate",
      check: "it gives check", castles: "it brings the king to safety", develops: "it develops a piece",
      wins: (p) => `it wins material (${p})`, fork: (ps) => `it attacks two pieces at once (${ps})`,
      saves: (p) => `it rescues a threatened piece (${p})`, threatens: (p) => `it attacks a loose piece (${p})`,
    },
    quiet: "a quiet move that improves the position",
    takeaway: {
      allowed_mate: "Before every move, look at every check the opponent could give next, especially on the squares around your king.",
      hung_piece: "Before you let go of a piece, ask: after this move, what can the opponent capture, and is it defended?",
      missed_mate: "When the enemy king is short of squares, look at every check first: there may be mate.",
      missed_win: "When you are winning, look for the forcing move first: checks, captures, threats.",
      missed_tactic: "Look for pieces that are loose or can be attacked twice at once. That is where tactics hide.",
      positional: "Compare your move with the better one: what does each do for your pieces and your king?",
    },
    kind: {
      allowed_mate: "allowing a quick checkmate", hung_piece: "leaving a piece unprotected", missed_mate: "missing a checkmate",
      missed_win: "missing a win", missed_tactic: "missing a tactic",
    },
    pattern: (n, t, l) => `A pattern from your recent games (${n} of your last ${t}): ${l}.`,
    weakPhase: (w, wa, b, ba) => `Your weakest phase lately: ${w}, ${wa}% accuracy (${b}: ${ba}%).`,
    phase: { opening: "the opening", middlegame: "the middlegame", endgame: "the endgame" },
    greatFinds: (n) => `Your recent games have ${n} great or brilliant moves.`,
    trainer: (n, m) => `This exact position is in your opening trainer (missed ${n}×); the right move there is ${m}.`,
    hint: {
      mateAvailable: "There is a checkmate for you in this position.",
      mateThreat: "The opponent threatens checkmate on the next move.",
      inCheck: "Your king is in check.",
      ourHanging: (ps) => `Under attack and not safe: ${ps}.`,
      theirHanging: (ps) => `The opponent has a poorly defended piece: ${ps}.`,
      undeveloped: (ps) => `Still at home: ${ps}. Development comes first.`,
      notCastled: "Your king has not castled yet.",
      topIdea: (r) => `What the engine's best move does: ${r}.`,
    },
  },
  bg: {
    on: "на",
    allowsMate: (m) => `След този ход противникът дава мат веднага: ${m}.`,
    hangs: (p) => `Остава без защита след хода: ${p}. Противникът може да спечели материал.`,
    opponentReply: (m) => `Най-силният отговор на противника: ${m}.`,
    reasons: {
      mate: "това е мат", stopsMate: "спира заплахата от мат", threatensMate: "заплашва мат",
      check: "дава шах", castles: "скрива царя на сигурно", develops: "развива фигура",
      wins: (p) => `печели материал (${p})`, fork: (ps) => `напада две фигури едновременно (${ps})`,
      saves: (p) => `спасява застрашена фигура (${p})`, threatens: (p) => `напада слабо защитена фигура (${p})`,
    },
    quiet: "тих ход, който подобрява позицията",
    takeaway: {
      allowed_mate: "Преди всеки ход провери всички шахове, които противникът може да даде след него, особено по полетата около царя ти.",
      hung_piece: "Преди да пуснеш фигурата, питай се: какво може да вземе противникът след този ход и защитено ли е?",
      missed_mate: "Когато противниковият цар е притиснат, провери първо всички шахове: може да има мат.",
      missed_win: "Когато печелиш, търси първо форсиращия ход: шахове, взимания, заплахи.",
      missed_tactic: "Търси незащитени фигури и такива, които могат да бъдат нападнати двойно. Там се крият тактиките.",
      positional: "Сравни хода си с по-добрия: какво прави всеки от тях за фигурите и царя ти?",
    },
    kind: {
      allowed_mate: "допуснат бърз мат", hung_piece: "оставена без защита фигура", missed_mate: "пропуснат мат",
      missed_win: "пропусната победа", missed_tactic: "пропусната тактика",
    },
    pattern: (n, t, l) => `Навик от последните ти партии (${n} от последните ${t}): ${l}.`,
    weakPhase: (w, wa, b, ba) => `Най-слабата ти фаза напоследък: ${w}, ${wa}% точност (${b}: ${ba}%).`,
    phase: { opening: "дебютът", middlegame: "мителшпилът", endgame: "ендшпилът" },
    greatFinds: (n) => `В последните ти партии има ${n} страхотни или брилянтни хода.`,
    trainer: (n, m) => `Тази позиция е в тренажора ти за дебюти (пропусната ${n} пъти); верният ход там е ${m}.`,
    hint: {
      mateAvailable: "В тази позиция имаш мат.",
      mateThreat: "Противникът заплашва мат със следващия ход.",
      inCheck: "Царят ти е в шах.",
      ourHanging: (ps) => `Под удар и без достатъчна защита: ${ps}.`,
      theirHanging: (ps) => `Противникът има слабо защитена фигура: ${ps}.`,
      undeveloped: (ps) => `Още неразвити: ${ps}. Развитието е първо.`,
      notCastled: "Царят ти още не е направил рокада.",
      topIdea: (r) => `Какво прави най-добрият ход според двигателя: ${r}.`,
    },
  },
  es: {
    on: "en",
    allowsMate: (m) => `Esta jugada permite al rival dar mate de inmediato: ${m}.`,
    hangs: (p) => `Queda sin protección tras esta jugada: ${p}. El rival puede ganar material.`,
    opponentReply: (m) => `La mejor respuesta del rival: ${m}.`,
    reasons: {
      mate: "es jaque mate", stopsMate: "detiene la amenaza de mate", threatensMate: "amenaza mate",
      check: "da jaque", castles: "pone al rey a salvo", develops: "desarrolla una pieza",
      wins: (p) => `gana material (${p})`, fork: (ps) => `ataca dos piezas a la vez (${ps})`,
      saves: (p) => `salva una pieza amenazada (${p})`, threatens: (p) => `ataca una pieza mal defendida (${p})`,
    },
    quiet: "una jugada tranquila que mejora la posición",
    takeaway: {
      allowed_mate: "Antes de cada jugada, revisa todos los jaques que el rival podría dar después, sobre todo en las casillas junto a tu rey.",
      hung_piece: "Antes de soltar la pieza, pregúntate: tras esta jugada, ¿qué puede capturar el rival y está defendido?",
      missed_mate: "Cuando al rey rival le faltan casillas, revisa primero todos los jaques: puede haber mate.",
      missed_win: "Cuando vas ganando, busca primero la jugada forzante: jaques, capturas, amenazas.",
      missed_tactic: "Busca piezas sueltas o que se puedan atacar dos a la vez: ahí se esconden las tácticas.",
      positional: "Compara tu jugada con la mejor: ¿qué hace cada una por tus piezas y tu rey?",
    },
    kind: {
      allowed_mate: "permitir un mate rápido", hung_piece: "dejar una pieza sin protección", missed_mate: "no ver un mate",
      missed_win: "dejar escapar una victoria", missed_tactic: "no ver una táctica",
    },
    pattern: (n, t, l) => `Un patrón de tus partidas recientes (${n} de las últimas ${t}): ${l}.`,
    weakPhase: (w, wa, b, ba) => `Tu fase más débil últimamente: ${w}, con ${wa}% de precisión (${b}: ${ba}%).`,
    phase: { opening: "la apertura", middlegame: "el medio juego", endgame: "el final" },
    greatFinds: (n) => `En tus partidas recientes hay ${n} jugadas geniales o brillantes.`,
    trainer: (n, m) => `Esta posición está en tu entrenador de aperturas (fallada ${n} veces); la jugada correcta es ${m}.`,
    hint: {
      mateAvailable: "En esta posición tienes mate.",
      mateThreat: "El rival amenaza mate en la próxima jugada.",
      inCheck: "Tu rey está en jaque.",
      ourHanging: (ps) => `Atacadas y sin protección suficiente: ${ps}.`,
      theirHanging: (ps) => `El rival tiene una pieza mal defendida: ${ps}.`,
      undeveloped: (ps) => `Todavía sin desarrollar: ${ps}. El desarrollo va primero.`,
      notCastled: "Tu rey todavía no se ha enrocado.",
      topIdea: (r) => `Lo que consigue la mejor jugada según el motor: ${r}.`,
    },
  },
  de: {
    on: "auf",
    allowsMate: (m) => `Nach diesem Zug kann der Gegner sofort mattsetzen: ${m}.`,
    hangs: (p) => `Nach diesem Zug ungedeckt: ${p}. Der Gegner kann Material gewinnen.`,
    opponentReply: (m) => `Die beste Antwort des Gegners: ${m}.`,
    reasons: {
      mate: "das ist Matt", stopsMate: "er verhindert die Mattdrohung", threatensMate: "er droht Matt",
      check: "er gibt Schach", castles: "er bringt den König in Sicherheit", develops: "er entwickelt eine Figur",
      wins: (p) => `er gewinnt Material (${p})`, fork: (ps) => `er greift zwei Figuren gleichzeitig an (${ps})`,
      saves: (p) => `er rettet eine bedrohte Figur (${p})`, threatens: (p) => `er greift eine schlecht gedeckte Figur an (${p})`,
    },
    quiet: "ein ruhiger Zug, der die Stellung verbessert",
    takeaway: {
      allowed_mate: "Prüfe vor jedem Zug alle Schachgebote, die der Gegner danach geben könnte, vor allem auf den Feldern um deinen König.",
      hung_piece: "Bevor du die Figur loslässt, frag dich: Was kann der Gegner nach diesem Zug schlagen, und ist es gedeckt?",
      missed_mate: "Wenn der gegnerische König wenig Felder hat, prüfe zuerst alle Schachgebote: Vielleicht ist es Matt.",
      missed_win: "Wenn du auf Gewinn stehst, such zuerst den forcierenden Zug: Schachs, Schlagzüge, Drohungen.",
      missed_tactic: "Such nach losen Figuren und nach Figuren, die man doppelt angreifen kann. Dort verstecken sich Taktiken.",
      positional: "Vergleich deinen Zug mit dem besseren: Was bewirkt jeder für deine Figuren und deinen König?",
    },
    kind: {
      allowed_mate: "schnelles Matt zugelassen", hung_piece: "Figur ungedeckt gelassen", missed_mate: "Matt übersehen",
      missed_win: "Gewinn verpasst", missed_tactic: "Taktik übersehen",
    },
    pattern: (n, t, l) => `Ein Muster aus deinen letzten Partien (${n} von ${t}): ${l}.`,
    weakPhase: (w, wa, b, ba) => `Deine schwächste Phase zuletzt: ${w}, ${wa} % Genauigkeit (${b}: ${ba} %).`,
    phase: { opening: "Eröffnung", middlegame: "Mittelspiel", endgame: "Endspiel" },
    greatFinds: (n) => `In deinen letzten Partien stehen ${n} großartige oder brillante Züge.`,
    trainer: (n, m) => `Diese Stellung steht in deinem Eröffnungstrainer (${n}× verpasst); richtig ist dort ${m}.`,
    hint: {
      mateAvailable: "In dieser Stellung hast du ein Matt.",
      mateThreat: "Der Gegner droht im nächsten Zug Matt.",
      inCheck: "Dein König steht im Schach.",
      ourHanging: (ps) => `Angegriffen und nicht ausreichend gedeckt: ${ps}.`,
      theirHanging: (ps) => `Der Gegner hat eine schlecht gedeckte Figur: ${ps}.`,
      undeveloped: (ps) => `Noch nicht entwickelt: ${ps}. Entwicklung geht vor.`,
      notCastled: "Dein König hat noch nicht rochiert.",
      topIdea: (r) => `Was der beste Zug der Engine bewirkt: ${r}.`,
    },
  },
  ru: {
    on: "на",
    allowsMate: (m) => `После этого хода соперник сразу ставит мат: ${m}.`,
    hangs: (p) => `После этого хода без защиты остаётся: ${p}. Соперник может выиграть материал.`,
    opponentReply: (m) => `Лучший ответ соперника: ${m}.`,
    reasons: {
      mate: "это мат", stopsMate: "он отражает угрозу мата", threatensMate: "он угрожает матом",
      check: "он объявляет шах", castles: "он уводит короля в безопасность", develops: "он развивает фигуру",
      wins: (p) => `он выигрывает материал (${p})`, fork: (ps) => `он нападает сразу на две фигуры (${ps})`,
      saves: (p) => `он спасает фигуру под ударом (${p})`, threatens: (p) => `он нападает на плохо защищённую фигуру (${p})`,
    },
    quiet: "спокойный ход, улучшающий позицию",
    takeaway: {
      allowed_mate: "Перед каждым ходом проверь все шахи, которые соперник сможет дать после него, особенно на полях вокруг твоего короля.",
      hung_piece: "Прежде чем отпустить фигуру, спроси себя: что соперник сможет взять после этого хода и защищено ли это?",
      missed_mate: "Когда у короля соперника мало полей, сначала проверь все шахи: может быть мат.",
      missed_win: "Когда у тебя выигрыш, сначала ищи форсированный ход: шахи, взятия, угрозы.",
      missed_tactic: "Ищи незащищённые фигуры и те, что можно атаковать сразу дважды: там прячется тактика.",
      positional: "Сравни свой ход с лучшим: что каждый из них даёт твоим фигурам и королю?",
    },
    kind: {
      allowed_mate: "допущен быстрый мат", hung_piece: "фигура оставлена без защиты", missed_mate: "пропущен мат",
      missed_win: "упущен выигрыш", missed_tactic: "пропущена тактика",
    },
    pattern: (n, t, l) => `Закономерность из твоих последних партий (${n} из ${t}): ${l}.`,
    weakPhase: (w, wa, b, ba) => `Твоя самая слабая фаза в последнее время: ${w}, точность ${wa}% (${b}: ${ba}%).`,
    phase: { opening: "дебют", middlegame: "миттельшпиль", endgame: "эндшпиль" },
    greatFinds: (n) => `В твоих последних партиях ${n} ${ruPlural(n, "отличный или блестящий ход", "отличных или блестящих хода", "отличных или блестящих ходов")}.`,
    trainer: (n, m) => `Эта позиция есть в твоём тренажёре дебютов (ошибок: ${n}); правильный ход там — ${m}.`,
    hint: {
      mateAvailable: "В этой позиции у тебя есть мат.",
      mateThreat: "Соперник угрожает матом следующим ходом.",
      inCheck: "Твоему королю объявлен шах.",
      ourHanging: (ps) => `Под ударом и без достаточной защиты: ${ps}.`,
      theirHanging: (ps) => `У соперника плохо защищённая фигура: ${ps}.`,
      undeveloped: (ps) => `Ещё не развиты: ${ps}. Сначала развитие.`,
      notCastled: "Твой король ещё не рокировался.",
      topIdea: (r) => `Что даёт лучший ход по мнению движка: ${r}.`,
    },
  },
  fa: {
    on: "در",
    allowsMate: (m) => `این حرکت به حریف اجازه می‌دهد فوراً مات کند: ${m}.`,
    hangs: (p) => `بعد از این حرکت بی‌دفاع ماند: ${p}. حریف می‌تواند مهره ببرد.`,
    opponentReply: (m) => `بهترین پاسخ حریف: ${m}.`,
    reasons: {
      mate: "این مات است", stopsMate: "تهدید مات را دفع می‌کند", threatensMate: "تهدید به مات می‌کند",
      check: "کیش می‌دهد", castles: "شاه را به جای امن می‌برد", develops: "یک مهره را گسترش می‌دهد",
      wins: (p) => `مهره می‌برد (${p})`, fork: (ps) => `هم‌زمان به دو مهره حمله می‌کند (${ps})`,
      saves: (p) => `مهرهٔ در خطر را نجات می‌دهد (${p})`, threatens: (p) => `به مهره‌ای که خوب دفاع نشده حمله می‌کند (${p})`,
    },
    quiet: "حرکتی آرام که موقعیت را بهتر می‌کند",
    takeaway: {
      allowed_mate: "قبل از هر حرکت، همهٔ کیش‌هایی را که حریف بعد از آن می‌تواند بدهد بررسی کن، مخصوصاً روی خانه‌های اطراف شاهت.",
      hung_piece: "قبل از اینکه مهره را رها کنی، از خودت بپرس: بعد از این حرکت حریف چه چیزی را می‌تواند بگیرد و آیا از آن دفاع شده؟",
      missed_mate: "وقتی شاه حریف خانهٔ کمی دارد، اول همهٔ کیش‌ها را بررسی کن: شاید مات باشد.",
      missed_win: "وقتی در حال بردن هستی، اول دنبال حرکت اجباری بگرد: کیش، گرفتن، تهدید.",
      missed_tactic: "دنبال مهره‌هایی بگرد که بی‌دفاع‌اند یا می‌شود هم‌زمان دو بار به آن‌ها حمله کرد. تاکتیک همان‌جا پنهان است.",
      positional: "حرکتت را با حرکت بهتر مقایسه کن: هر کدام برای مهره‌ها و شاهت چه می‌کند؟",
    },
    kind: {
      allowed_mate: "اجازه دادن به مات سریع", hung_piece: "بی‌دفاع گذاشتن مهره", missed_mate: "از دست دادن مات",
      missed_win: "از دست دادن برد", missed_tactic: "ندیدن تاکتیک",
    },
    pattern: (n, t, l) => `الگویی از بازی‌های اخیرت (${n} از ${t} بازی آخر): ${l}.`,
    weakPhase: (w, wa, b, ba) => `ضعیف‌ترین مرحلهٔ بازی‌ات در این اواخر: ${w}، با دقت ${wa}% (${b}: ${ba}%).`,
    phase: { opening: "گشایش", middlegame: "وسط بازی", endgame: "آخر بازی" },
    greatFinds: (n) => `در بازی‌های اخیرت ${n} حرکت عالی یا درخشان داشته‌ای.`,
    trainer: (n, m) => `همین موقعیت در تمرین‌دهندهٔ گشایش تو هست (${n} بار اشتباه)؛ حرکت درست آنجا ${m} است.`,
    hint: {
      mateAvailable: "در این موقعیت برای تو یک مات وجود دارد.",
      mateThreat: "حریف تهدید می‌کند در حرکت بعد مات کند.",
      inCheck: "شاه تو کیش است.",
      ourHanging: (ps) => `زیر حمله و ناامن: ${ps}.`,
      theirHanging: (ps) => `حریف مهره‌ای دارد که خوب دفاع نشده: ${ps}.`,
      undeveloped: (ps) => `هنوز در خانهٔ اول: ${ps}. اول گسترش مهره‌ها.`,
      notCastled: "شاه تو هنوز قلعه نرفته است.",
      topIdea: (r) => `کاری که بهترین حرکت موتور انجام می‌دهد: ${r}.`,
    },
  },
};

export const phrases = (lang: Language): Phrases => PHRASES[lang] ?? PHRASES.en;

function pieceLabel(p: PieceRef, lang: Language, audience: Audience): string {
  return `${pieceNames(lang, audience)[p.type.toUpperCase()]} ${phrases(lang).on} ${p.square}`;
}
const pieceList = (ps: PieceRef[], lang: Language, aud: Audience) => ps.map((p) => pieceLabel(p, lang, aud)).join(", ");

/** What a move achieves, most important first. Empty for a plain quiet move. */
export function moveReasons(m: MoveMotifs, lang: Language, aud: Audience): string[] {
  const r = phrases(lang).reasons;
  const out: string[] = [];
  if (m.mate) return [r.mate];
  if (m.stopsMate) out.push(r.stopsMate);
  if (m.fork.length) out.push(r.fork(pieceList(m.fork, lang, aud)));
  if (m.captured) out.push(r.wins(pieceLabel(m.captured, lang, aud)));
  if (m.threatensMate) out.push(r.threatensMate);
  if (m.saves.length) out.push(r.saves(pieceLabel(m.saves[0]!, lang, aud)));
  if (!m.fork.length && m.threatens.length) out.push(r.threatens(pieceLabel(m.threatens[0]!, lang, aud)));
  if (m.castles) out.push(r.castles);
  if (m.develops) out.push(r.develops);
  if (m.check && !m.fork.length) out.push(r.check);
  return out.slice(0, 3);
}

// ─── Verdict tone ───────────────────────────────────────────────────────────

const BAD: Classification[] = ["inaccuracy", "mistake", "blunder", "miss"];
const PRAISE_WORTHY: Classification[] = ["brilliant", "great", "best", "excellent"];

/** "praise" — the coach may praise; "correct" — a mistake, no praise at all;
 *  "neutral" — fine, but nothing to celebrate. */
export function toneFor(c: Classification): "praise" | "correct" | "neutral" {
  if (BAD.includes(c)) return "correct";
  return PRAISE_WORTHY.includes(c) ? "praise" : "neutral";
}

// ─── Next steps on the platform ─────────────────────────────────────────────

export type CoachAction =
  | { kind: "learn"; lesson: string }
  | { kind: "train" };

const LESSON_FOR: Record<MistakeKind, string> = {
  allowed_mate: "mate-in-one",
  hung_piece: "hanging",
  missed_mate: "mate-in-one",
  missed_win: "hanging",
  missed_tactic: "fork",
};

function actionsFor(kind: MistakeKind | null, fenAfter: string | null): CoachAction[] {
  if (!kind) return [];
  let lesson = LESSON_FOR[kind];
  // A mate against a king boxed in on its back rank is the back-rank pattern.
  if (kind === "allowed_mate" && fenAfter) {
    const mover = fenAfter.split(" ")[1] === "w" ? "black" : "white";
    if (hasBackRankSignature(fenAfter, mover)) lesson = "back-rank";
  }
  return [{ kind: "learn", lesson }, { kind: "train" }];
}

// ─── Explain ────────────────────────────────────────────────────────────────

export interface ExplainCoachingInput {
  fen: string;
  played_san: string;
  best_san: string | null;
  classification: Classification;
  userId: number;
  /** Whether the move is the user's own (memory only applies to them). */
  ownMove: boolean;
}

export interface ExplainCoaching {
  facts: Record<string, unknown>;
  actions: CoachAction[];
  /** Filled in from the engine when the client didn't send them (Play). */
  eval_before_cp: number | null;
  eval_after_cp: number | null;
  mistakeKind: MistakeKind | null;
}

export async function explainCoaching(input: ExplainCoachingInput, lang: Language, aud: Audience): Promise<ExplainCoaching> {
  const P = phrases(lang);
  const nat = (san: string, fen: string) => sanToNatural(san, fen, lang, aud);
  const tone = toneFor(input.classification);
  const played = moveMotifs(input.fen, input.played_san);

  let fenAfter: string | null = null;
  try {
    const c = new Chess(input.fen);
    c.move(input.played_san, { strict: false });
    fenAfter = c.fen();
  } catch { /* leave null */ }

  const [before, after] = await Promise.all([
    coachEngine(input.fen, 3),
    fenAfter && !new Chess(fenAfter).isGameOver() ? coachEngine(fenAfter, 1) : Promise.resolve(null),
  ]);

  // WHY — concrete consequences of the move on the board.
  const why: string[] = [];
  if (played) {
    if (tone === "correct") {
      if (played.allowsMate) why.push(P.allowsMate(nat(played.allowsMate, fenAfter!)));
      else if (played.hangs.length) why.push(P.hangs(pieceList(played.hangs.slice(0, 2), lang, aud)));
    } else {
      const reasons = moveReasons(played, lang, aud);
      if (reasons.length) why.push(`${nat(input.played_san, input.fen)}: ${reasons.join("; ")}.`);
    }
  }

  // The opponent's best answer to the move and how it goes on, from the
  // engine — a few plies, so a loss that takes an exchange to show (not just
  // one capture) still has a concrete "why".
  let opponentReply: string | null = null;
  if (after?.[0] && fenAfter) {
    const line = naturalLine(fenAfter, after[0].pv, 3, lang, aud);
    if (line.length) opponentReply = P.opponentReply(line.join(", "));
  }

  // Better and alternative moves with what they achieve.
  const bestSan = input.best_san ?? (before?.[0]?.pv[0] ? uciToSan(input.fen, before[0].pv[0]) : null);
  const describe = (san: string) => {
    const m = moveMotifs(input.fen, san);
    const reasons = m ? moveReasons(m, lang, aud) : [];
    return `${nat(san, input.fen)}: ${reasons.length ? reasons.join("; ") : P.quiet}`;
  };
  const isBest = !bestSan || bestSan === input.played_san;
  const betterMove = isBest ? null : describe(bestSan);

  const others: string[] = [];
  if (before && before.length > 1) {
    const top = cpForMover(before[0]!, input.fen);
    for (const line of before.slice(1)) {
      const san = line.pv[0] ? uciToSan(input.fen, line.pv[0]) : null;
      if (!san || san === bestSan || san === input.played_san) continue;
      // Only moves that are nearly as good as the best one are alternatives.
      if (top - cpForMover(line, input.fen) > 60) continue;
      others.push(describe(san));
    }
  }

  // The player's history: the same kind of mistake before, the weak phase,
  // strengths, and the opening trainer.
  const kind = input.ownMove && played ? mistakeKind({ fen_before: input.fen, san: input.played_san, best_move_san: bestSan, classification: input.classification }) : null;
  const history: string[] = [];
  let memory: PlayerMemory | null = null;
  if (input.ownMove) {
    memory = playerMemory(input.userId);
    if (kind && memory.gamesReviewed >= 3 && memory.mistakeGames[kind] >= 2) {
      history.push(P.pattern(memory.mistakeGames[kind], memory.gamesReviewed, P.kind[kind]));
    }
    const wp = weakestPhase(memory);
    const phaseNow = positionFeatures(input.fen)?.phase;
    if (wp && tone === "correct" && wp.weak === phaseNow) {
      history.push(P.weakPhase(P.phase[wp.weak], wp.weakAcc, P.phase[wp.best], wp.bestAcc));
    }
    if ((input.classification === "great" || input.classification === "brilliant") && memory.greatFinds >= 2) {
      history.push(P.greatFinds(memory.greatFinds));
    }
    const trainer = missedInTrainer(input.userId, input.fen);
    if (trainer && trainer.expected_san !== input.played_san) {
      history.push(P.trainer(trainer.misses, nat(trainer.expected_san, input.fen)));
    }
  }

  // Evaluations from the engine, for callers that didn't send them.
  const evalBefore = before?.[0] ? whiteCp(before[0]) : null;
  const evalAfter = after?.[0] ? whiteCp(after[0]) : null;

  return {
    facts: {
      tone,
      verdict: verdictPhrase(input.classification, lang),
      why,
      opponent_reply: tone === "correct" ? opponentReply : null,
      better_move: betterMove,
      other_good_moves: others,
      takeaway: tone === "correct" ? P.takeaway[kind ?? "positional"] : null,
      player_history: history,
    },
    actions: tone === "correct" ? actionsFor(kind, fenAfter) : [],
    eval_before_cp: evalBefore,
    eval_after_cp: evalAfter,
    mistakeKind: kind,
  };
}

function whiteCp(line: EngineLine): number {
  return line.mate != null ? (line.mate > 0 ? 10000 : -10000) : (line.cp ?? 0);
}

// ─── Hint ───────────────────────────────────────────────────────────────────

export async function hintCoaching(fen: string, userId: number, lang: Language, aud: Audience): Promise<{ facts: Record<string, unknown>; actions: CoachAction[] }> {
  const P = phrases(lang);
  const f = positionFeatures(fen);
  if (!f) return { facts: {}, actions: [] };
  const look: string[] = [];
  if (f.inCheck) look.push(P.hint.inCheck);
  if (f.mateAvailable) look.push(P.hint.mateAvailable);
  if (f.mateThreat) look.push(P.hint.mateThreat);
  if (f.ourHanging.length) look.push(P.hint.ourHanging(pieceList(f.ourHanging.slice(0, 2), lang, aud)));
  if (f.theirHanging.length) look.push(P.hint.theirHanging(pieceList(f.theirHanging.slice(0, 2), lang, aud)));
  if (f.undeveloped.length >= 2) look.push(P.hint.undeveloped(pieceList(f.undeveloped, lang, aud)));
  if (f.castling === "available" && f.phase !== "endgame" && Number(fen.split(" ")[5] ?? 1) >= 5) look.push(P.hint.notCastled);

  // What the best move achieves — never the move itself.
  const lines = await coachEngine(fen, 1);
  let idea: string | null = null;
  let state: string | null = null;
  if (lines?.[0]) {
    const san = lines[0].pv[0] ? uciToSan(fen, lines[0].pv[0]) : null;
    const m = san ? moveMotifs(fen, san) : null;
    if (m) {
      // A capture names its target, which gives the move away on its own.
      const reasons = moveReasons({ ...m, captured: null }, lang, aud).filter((r) => r !== P.reasons.mate);
      idea = P.hint.topIdea(reasons.length ? reasons.join("; ") : P.quiet);
    }
    const cp = cpForMover(lines[0], fen);
    state = evaluationStateNatural(cpToWinPct(cp), lang);
  }

  // One habit worth remembering in this phase.
  const memory = playerMemory(userId);
  const history: string[] = [];
  let topKind: MistakeKind | null = null;
  if (memory.gamesReviewed >= 3) {
    const [k, n] = (Object.entries(memory.mistakeGames) as [MistakeKind, number][]).sort((a, b) => b[1] - a[1])[0]!;
    if (n >= 2) {
      topKind = k;
      history.push(P.pattern(n, memory.gamesReviewed, P.kind[k]));
    }
    const wp = weakestPhase(memory);
    if (wp && wp.weak === f.phase) history.push(P.weakPhase(P.phase[wp.weak], wp.weakAcc, P.phase[wp.best], wp.bestAcc));
  }

  return {
    facts: {
      phase: P.phase[f.phase],
      evaluation_state: state,
      where_to_look: look,
      best_move_idea: idea,
      player_history: history,
      takeaway: topKind ? P.takeaway[topKind] : null,
    },
    actions: [],
  };
}

// ─── Guard ──────────────────────────────────────────────────────────────────

// The coach must never contradict the engine. The prompt says so, but a
// model can still open a blunder with "Great development…" (#37), so the
// answer is checked before anyone sees it.
const PRAISE: Record<Language, RegExp> = {
  en: /\b(great|excellent|brilliant|well played|nicely|nice move|good move|strong move|solid|fantastic|superb|perfect|clever|well done)\b/i,
  // Comparatives are not praise: "по-добър ход" is "a better move" — the
  // mistake verdict itself says it.
  bg: /(страхотн|отличн|брилянтн|браво|(?<!по-)добър ход|добре изигран|(?<!по-)силен ход|солид|перфектн|чудесн|хубав ход|умен ход)/i,
  es: /(gran jugada|genial|excelente|brillante|bien jugad|buena jugada|jugada fuerte|sólid|perfect|estupend|bien hecho)/i,
  de: /(großartig|ausgezeichnet|brillant|gut gespielt|guter zug|starker zug|solide|perfekt|klasse zug|stark gespielt|gut gemacht|schöner zug)/i,
  ru: /(отличн|блестящ|прекрасн|молодец|хороший ход|(?<!более )сильный ход|здорово|великолепн|солидн|хорошо сыграно)/i,
  // Farsi words are glued with a zero-width non-joiner or a plain space
  // depending on the writer, so compound words accept either.
  fa: /(عالی|درخشان|آفرین|حرکت خوب|حرکت قوی|خوب بازی کرد|فوق[‌ ]?العاده|بی[‌ ]?نقص|هوشمندانه|محکم|کارت خوب بود|بسیار خوب|زیبا بود)/,
};
const BLAME: Record<Language, RegExp> = {
  en: /\b(blunder|mistake|inaccura)/i,
  bg: /(грешк|блъндер|неточност|гаф)/i,
  es: /(error|imprecisi|fallo grave)/i,
  de: /(fehler|ungenauigkeit)/i,
  ru: /(ошибк|зевок|неточност)/i,
  fa: /(اشتباه|بی[‌ ]?دقتی|خطا)/,
};

const firstSentence = (t: string) => t.trim().split(/(?<=[.!?…])\s/)[0] ?? t;

/** Why an answer contradicts the verdict, or null when it's consistent. */
export function contradiction(text: string, classification: Classification, lang: Language): string | null {
  const tone = toneFor(classification);
  if (tone === "correct") {
    const praise = PRAISE[lang] ?? PRAISE.en;
    // The opening sets the verdict the player hears; later sentences may
    // fairly call the *better* move strong, but not the one that was played.
    if (praise.test(firstSentence(text))) return "praise_for_mistake";
  } else if (BLAME[lang]?.test(text) || BLAME.en.test(text)) {
    return "blame_for_good_move";
  }
  return null;
}

/** A plain, correct answer built from FACTS alone — used when the model
 *  can't produce a consistent one. */
export function fallbackText(c: ExplainCoaching["facts"], lang: Language): string {
  const verdict = String(c.verdict ?? "");
  const parts = [verdict.charAt(0).toUpperCase() + verdict.slice(1) + "."];
  for (const w of (c.why as string[]) ?? []) parts.push(w);
  if (c.opponent_reply) parts.push(String(c.opponent_reply));
  if (c.better_move) parts.push(`${betterWord(lang)} ${String(c.better_move)}.`);
  if (c.takeaway) parts.push(String(c.takeaway));
  return parts.join(" ");
}

function betterWord(lang: Language): string {
  return { en: "Better:", bg: "По-добре:", es: "Mejor:", de: "Besser:", ru: "Лучше:", fa: "بهتر:" }[lang] ?? "Better:";
}
