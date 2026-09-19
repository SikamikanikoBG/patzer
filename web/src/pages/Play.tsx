import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Flag, Lightbulb, Swords, Bot, Users as UsersIcon, Check, X, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Radio, Sparkles, FlipVertical2, ListOrdered, Handshake, Undo2, MoreHorizontal, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence, useDragControls, useReducedMotion } from 'framer-motion';
import { Chess } from 'chess.js';
import ChessBoard from '../components/ChessBoard';
import ClassificationBadge from '../components/ClassificationBadge';
import CoachPanel from '../components/CoachPanel';
import CapturedPieces from '../components/CapturedPieces';
import PieceEmotionsOverlay from '../components/PieceEmotionsOverlay';
import Spinner from '../components/Spinner';
import { useAuth } from '../state/auth';
import { useLobby } from '../state/lobby';
import { fmtClock } from '../lib/utils';
import { api } from '../api';
import { soundForMove, inferMoveFlagsFromSan, playSound } from '../lib/sounds';
import type { Difficulty, Classification } from '../types';

const DIFFICULTIES: Difficulty[] = ['kid','beginner','easy','medium','hard','master','stockfish'];
const TIME_CONTROLS = ['untimed','bullet','blitz','rapid','classical'] as const;

interface Move { ply: number; san: string; uci: string; classification?: Classification }
interface Position { fen: string; lastFrom?: string; lastTo?: string }

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

interface ServerMsg {
  type: string;
  fen?: string;
  san?: string;
  uci?: string;
  by?: 'user' | 'engine' | 'opponent' | 'white' | 'black';
  // pvp offers
  draw_offer?: 'white' | 'black' | null;
  takeback_request?: 'white' | 'black' | null;
  whiteTimeMs?: number;
  blackTimeMs?: number;
  result?: '1-0' | '0-1' | '1/2-1/2';
  reason?: string;
  game_id?: number;
  best_uci?: string;
  message?: string;
  ply?: number;
  classification?: Classification;
  cp_loss?: number;
  best_san?: string;
  // pvp_hello fields
  your_color?: 'white' | 'black';
  opponent?: { user_id: number; display_name: string; online: boolean };
  you?: { user_id: number; display_name: string };
  time_control?: string;
  history?: string[];
  turn?: 'w' | 'b';
  // preview_result fields
  ok?: boolean;
  eval_after_cp?: number;
  // opponent_status
  online?: boolean;
}

interface BlunderPreview { uci: string; classification: Classification; cp_loss: number; best_uci: string | null; best_san: string | null; eval_after_cp: number }

export default function Play() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lobby = useLobby();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const pvpGameId = Number(params.get('game') ?? 0) || null;

  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup');
  const [setupTab, setSetupTab] = useState<'bot' | 'friend'>('bot');

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [color, setColor] = useState<'white' | 'black' | 'random'>('white');
  const [tc, setTc] = useState<typeof TIME_CONTROLS[number]>('untimed');

  const [fen, setFen] = useState(START_FEN);
  const [moves, setMoves] = useState<Move[]>([]);
  // Per-ply positions, used both for the last-move highlight and the rewind UI.
  const [positions, setPositions] = useState<Position[]>([{ fen: START_FEN }]);
  // null = at the live position; otherwise an index into `positions` (read-only browse mode).
  const [browseIndex, setBrowseIndex] = useState<number | null>(null);
  const [userColor, setUserColor] = useState<'white' | 'black'>('white');
  // Board flip + the phone-only moves sheet (see the sticky bottom bar).
  const [flipped, setFlipped] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const sheetDragControls = useDragControls();
  const movesTouchStartY = useRef<number | null>(null);
  // PvP negotiation state: who has a standing offer, from my point of view.
  type Offer = 'me' | 'them' | null;
  const [drawOffer, setDrawOffer] = useState<Offer>(null);
  const [takeback, setTakeback] = useState<Offer>(null);
  const [rematch, setRematch] = useState<Offer>(null);
  const [rematchDeclined, setRematchDeclined] = useState(false);
  const userColorRef = useRef<'white' | 'black'>('white');
  useEffect(() => { userColorRef.current = userColor; }, [userColor]);
  const orientation: 'white' | 'black' = flipped ? (userColor === 'white' ? 'black' : 'white') : userColor;
  const [whiteMs, setWhiteMs] = useState(0);
  const [blackMs, setBlackMs] = useState(0);
  const [result, setResult] = useState<{ result: string; reason: string; gameId?: number } | null>(null);
  const [coachConfigured, setCoachConfigured] = useState(false);
  const [hint, setHint] = useState<{ from: string; to: string } | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [opponent, setOpponent] = useState<{ display_name: string; online: boolean } | null>(null);
  const [blunder, setBlunder] = useState<BlunderPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [lastClassifiedMove, setLastClassifiedMove] = useState<{ ply: number; san: string; uci: string; classification: Classification; cp_loss: number; best_san: string | null; fen_before: string } | null>(null);
  const [boardArrows, setBoardArrows] = useState<{ orig: string; dest: string; brush: string }[]>([]);
  const [boardKey, setBoardKey] = useState(0);
  const forceBoardSync = () => setBoardKey((k) => k + 1);

  const wsRef = useRef<WebSocket | null>(null);
  const tickRef = useRef<number | null>(null);
  const fenBeforeMoveRef = useRef<string>(fen);

  useEffect(() => {
    api.get<{ configured: boolean }>('/api/coach/status')
      .then((s) => setCoachConfigured(s.configured))
      .catch(() => setCoachConfigured(false));
  }, []);

  // PvP: auto-connect when arriving with ?game=ID
  useEffect(() => {
    if (pvpGameId && phase === 'setup') connectPvp(pvpGameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvpGameId]);

  // Refresh users + challenges when entering friend tab
  useEffect(() => {
    if (setupTab === 'friend') {
      void lobby.refreshUsers();
      void lobby.refreshChallenges();
    }
  }, [setupTab, lobby]);

  // Local clock tick during play
  useEffect(() => {
    if (phase !== 'playing' || tc === 'untimed') return;
    const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
    const id = window.setInterval(() => {
      if (turn === 'white') setWhiteMs((m) => Math.max(0, m - 100));
      else setBlackMs((m) => Math.max(0, m - 100));
    }, 100);
    tickRef.current = id;
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [phase, fen, tc]);

  // Show suggested-move arrow when hint arrives
  useEffect(() => {
    setBoardArrows(hint ? [{ orig: hint.from, dest: hint.to, brush: 'green' }] : []);
  }, [hint]);

  function startBot() {
    const finalColor = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    setUserColor(finalColor);
    resetGameState();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/play`);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'new_game', difficulty, color: finalColor, time_control: tc }));
    };
    ws.onmessage = handleMessage;
    ws.onclose = () => { /* ignore */ };
  }

  function connectPvp(gameId: number) {
    resetGameState();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/play?game=${gameId}`);
    wsRef.current = ws;
    ws.onmessage = handleMessage;
    ws.onclose = () => { /* ignore */ };
  }

  function resetGameState() {
    setFen(START_FEN);
    setMoves([]); setResult(null); setHint(null); setLastClassifiedMove(null);
    setOpponent(null); setBoardArrows([]);
    setPositions([{ fen: START_FEN }]);
    setBrowseIndex(null);
    setGameOverDismissed(false);
    setDrawOffer(null); setTakeback(null); setRematch(null); setRematchDeclined(false);
    setMoreOpen(false); setSheetOpen(false);
  }

  /** Rebuild the per-ply position list + move list from a SAN history. Used
   *  on (re)connect and after an accepted takeback. */
  function loadHistory(history: string[] | undefined, startFen: string) {
    if (history && history.length > 0) {
      const replay = new Chess();
      const positionsFromHistory: Position[] = [{ fen: replay.fen() }];
      const movesFromHistory: Move[] = [];
      for (let i = 0; i < history.length; i++) {
        const san = history[i]!;
        const m = replay.move(san, { strict: false });
        if (!m) break;
        positionsFromHistory.push({ fen: replay.fen(), lastFrom: m.from, lastTo: m.to });
        movesFromHistory.push({ ply: i + 1, san: m.san, uci: m.from + m.to + (m.promotion ?? '') });
      }
      setPositions(positionsFromHistory);
      setMoves(movesFromHistory);
    } else {
      setPositions([{ fen: startFen }]);
      setMoves([]);
    }
    setBrowseIndex(null);
  }

  const mine = (by: string | undefined): Offer => (by ? (by === userColorRef.current ? 'me' : 'them') : null);

  function handleMessage(ev: MessageEvent) {
    const msg = JSON.parse(ev.data) as ServerMsg;
    switch (msg.type) {
      case 'game_started':
      case 'pvp_hello': {
        setPhase('playing');
        const startFen = msg.fen ?? START_FEN;
        if (msg.fen) setFen(msg.fen);
        if (msg.your_color) setUserColor(msg.your_color);
        if (msg.opponent) setOpponent({ display_name: msg.opponent.display_name, online: msg.opponent.online });
        if (msg.whiteTimeMs !== undefined) setWhiteMs(msg.whiteTimeMs);
        if (msg.blackTimeMs !== undefined) setBlackMs(msg.blackTimeMs);
        if (msg.time_control) setTc(msg.time_control as typeof TIME_CONTROLS[number]);
        if (msg.your_color) userColorRef.current = msg.your_color;
        // Rebuild the position list from the SAN history (PvP reconnect can land mid-game).
        loadHistory(msg.history, startFen);
        setDrawOffer(mine(msg.draw_offer ?? undefined));
        setTakeback(mine(msg.takeback_request ?? undefined));
        playSound('game_start');
        break;
      }
      // ---- PvP negotiation ----
      case 'draw_offered':
        setDrawOffer(mine(msg.by));
        if (msg.by !== userColorRef.current) playSound('game_start');
        break;
      case 'draw_declined':
        setDrawOffer(null);
        break;
      case 'takeback_requested':
        setTakeback(mine(msg.by));
        if (msg.by !== userColorRef.current) playSound('game_start');
        break;
      case 'takeback_declined':
        setTakeback(null);
        break;
      case 'takeback_applied': {
        setTakeback(null); setDrawOffer(null);
        if (msg.fen) setFen(msg.fen);
        loadHistory(msg.history, msg.fen ?? START_FEN);
        if (msg.whiteTimeMs !== undefined) setWhiteMs(msg.whiteTimeMs);
        if (msg.blackTimeMs !== undefined) setBlackMs(msg.blackTimeMs);
        setHint(null); setLastClassifiedMove(null); setBlunder(null); setPreviewing(false);
        forceBoardSync();
        break;
      }
      case 'rematch_offered':
        setRematch(mine(msg.by));
        setRematchDeclined(false);
        if (msg.by !== userColorRef.current) { setGameOverDismissed(false); playSound('game_start'); }
        break;
      case 'rematch_declined':
        setRematch(null);
        setRematchDeclined(true);
        break;
      case 'rematch_start':
        if (msg.game_id) {
          try { wsRef.current?.close(); } catch { /* ignore */ }
          wsRef.current = null;
          setPhase('setup');
          resetGameState();
          nav(`/play?game=${msg.game_id}`);
        }
        break;
      case 'opponent_status':
        setOpponent((o) => o ? { ...o, online: !!msg.online } : o);
        break;
      case 'move_made': {
        if (msg.fen) setFen(msg.fen);
        if (msg.san && msg.uci) {
          const flags = inferMoveFlagsFromSan(msg.san);
          soundForMove(flags);
          setMoves((m) => [...m, { ply: m.length + 1, san: msg.san!, uci: msg.uci! }]);
        }
        if (msg.fen && msg.uci) {
          const from = msg.uci.slice(0, 2);
          const to = msg.uci.slice(2, 4);
          setPositions((p) => [...p, { fen: msg.fen!, lastFrom: from, lastTo: to }]);
        }
        if (msg.whiteTimeMs !== undefined) setWhiteMs(msg.whiteTimeMs);
        if (msg.blackTimeMs !== undefined) setBlackMs(msg.blackTimeMs);
        setHint(null);
        setDrawOffer(null); setTakeback(null);
        break;
      }
      case 'move_classified': {
        if (msg.ply !== undefined && msg.classification) {
          setMoves((m) => m.map((x) => x.ply === msg.ply ? { ...x, classification: msg.classification } : x));
          // For coach: only set lastClassifiedMove if THIS was the user's move (in bot mode, by:'user')
          if (msg.by === 'user') {
            setMoves((m) => {
              const target = m[msg.ply! - 1];
              if (target) {
                setLastClassifiedMove({
                  ply: msg.ply!,
                  san: target.san,
                  uci: target.uci,
                  classification: msg.classification!,
                  cp_loss: msg.cp_loss ?? 0,
                  best_san: msg.best_san ?? null,
                  fen_before: fenBeforeMoveRef.current,
                });
              }
              return m;
            });
          }
        }
        break;
      }
      case 'preview_result': {
        setPreviewing(false);
        if (!msg.ok) { setBlunder(null); break; }
        const cls = msg.classification!;
        // If kid mode AND it's a mistake/blunder/miss, prompt
        if ((cls === 'mistake' || cls === 'blunder' || cls === 'miss') && user?.profile.blunder_warning) {
          setBlunder({
            uci: msg.uci!,
            classification: cls,
            cp_loss: msg.cp_loss ?? 0,
            best_uci: msg.best_uci ?? null,
            best_san: msg.best_san ?? null,
            eval_after_cp: msg.eval_after_cp ?? 0,
          });
        } else {
          // No warning needed — commit the move
          commitMove(msg.uci!);
        }
        break;
      }
      case 'game_over':
        setPhase('over');
        playSound('game_end');
        if (msg.result) setResult({ result: msg.result, reason: msg.reason ?? '' });
        break;
      case 'game_saved':
        if (msg.game_id) setResult((r) => r ? { ...r, gameId: msg.game_id } : { result: '?', reason: '?', gameId: msg.game_id });
        break;
      case 'hint':
        setHintLoading(false);
        if (msg.best_uci) setHint({ from: msg.best_uci.slice(0, 2), to: msg.best_uci.slice(2, 4) });
        break;
      case 'analysis_ready':
        // PvP analysis is ready — could refresh UI; for now just no-op
        break;
      case 'error':
        // Server rejected something (illegal move etc) — re-sync the board
        forceBoardSync();
        setPreviewing(false);
        break;
    }
  }

  function attemptMove(uci: string) {
    if (!wsRef.current) return;
    const enableWarning = !!user?.profile.blunder_warning;
    fenBeforeMoveRef.current = fen;
    if (enableWarning) {
      setPreviewing(true);
      wsRef.current.send(JSON.stringify({ type: 'preview_move', uci }));
    } else {
      commitMove(uci);
    }
  }

  function commitMove(uci: string) {
    setBlunder(null);
    wsRef.current?.send(JSON.stringify({ type: 'move', uci }));
  }

  function tryAnotherMove() {
    setBlunder(null);
    forceBoardSync(); // roll back the chessground visual to the authoritative FEN
  }

  function resign() { wsRef.current?.send(JSON.stringify({ type: 'resign' })); }
  const sendType = (type: string) => wsRef.current?.send(JSON.stringify({ type }));
  const offerDraw = () => sendType('offer_draw');
  const acceptDraw = () => sendType('accept_draw');
  const declineDraw = () => sendType('decline_draw');
  const requestTakeback = () => sendType('request_takeback');
  const acceptTakeback = () => sendType('accept_takeback');
  const declineTakeback = () => sendType('decline_takeback');
  const offerRematch = () => sendType('offer_rematch');
  const acceptRematch = () => sendType('accept_rematch');
  const declineRematch = () => sendType('decline_rematch');
  function requestHint() {
    setHintLoading(true);
    wsRef.current?.send(JSON.stringify({ type: 'request_hint' }));
  }

  function startSheetDrag(event: React.PointerEvent<HTMLElement>) {
    if (!reduceMotion) sheetDragControls.start(event);
  }

  function handleMovesPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (reduceMotion || event.pointerType === 'mouse') return;
    movesTouchStartY.current = event.clientY;
  }

  function handleMovesPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const startY = movesTouchStartY.current;
    movesTouchStartY.current = null;
    if (reduceMotion || startY === null) return;
    if (startY - event.clientY > 48) setSheetOpen(true);
  }

  const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  // Browse / live state
  const liveIndex = positions.length - 1;
  const isBrowsing = browseIndex !== null && browseIndex !== liveIndex;
  const displayedPos = positions[browseIndex ?? liveIndex] ?? positions[0]!;
  const displayedFen = isBrowsing ? displayedPos.fen : fen;
  const displayedLastMove: [string, string] | undefined = displayedPos.lastFrom && displayedPos.lastTo
    ? [displayedPos.lastFrom, displayedPos.lastTo]
    : undefined;
  const movable = phase === 'playing' && turn === userColor && !blunder && !previewing && !isBrowsing;
  const goToLive = () => setBrowseIndex(null);
  const stepBack = () => setBrowseIndex((b) => Math.max(0, (b ?? liveIndex) - 1));
  const stepForward = () => setBrowseIndex((b) => {
    const next = (b ?? liveIndex) + 1;
    if (next >= liveIndex) return null;
    return next;
  });

  // Keyboard nav for the browse rewind (skip when typing in inputs)
  useEffect(() => {
    if (phase !== 'playing') return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepBack(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepForward(); }
      else if (e.key === 'Home') { e.preventDefault(); setBrowseIndex(0); }
      else if (e.key === 'End') { e.preventDefault(); goToLive(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, liveIndex]);

  // ---- SETUP screen ----
  if (phase === 'setup' && !pvpGameId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <header>
          <h1 className="page-h1">{t('play.newGame')}</h1>
          <p className="page-sub">Pick a bot or challenge a friend.</p>
        </header>
        <div className="flex gap-2">
          <TabButton active={setupTab === 'bot'} onClick={() => setSetupTab('bot')} icon={Bot}>{t('play.tabBot')}</TabButton>
          <TabButton active={setupTab === 'friend'} onClick={() => setSetupTab('friend')} icon={UsersIcon}>{t('play.tabFriend')}</TabButton>
        </div>

        {setupTab === 'bot' && (
          <div className="card space-y-6 p-5 sm:p-6">
            <div>
              <div className="label mb-2">{t('play.difficulty')}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DIFFICULTIES.map((d) => (
                  <button key={d} onClick={() => setDifficulty(d)}
                    className={`rounded-md border p-3 text-left transition-colors
                      ${difficulty === d
                        ? 'border-green-500 bg-green-500 text-white shadow-soft'
                        : 'border-chesscom-200 bg-white hover:border-chesscom-300 dark:border-chesscom-700 dark:bg-chesscom-800 dark:hover:border-chesscom-600'}`}>
                    <div className="text-sm font-semibold">{t(`play.diff.${d}`)}</div>
                    <div className={`mt-1 text-xs ${difficulty === d ? 'opacity-90' : 'text-chesscom-500'}`}>{t(`play.diffDesc.${d}`)}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-2">{t('play.color')}</div>
              <div className="grid grid-cols-3 gap-2">
                {(['white','random','black'] as const).map((c) => (
                  <button key={c} onClick={() => setColor(c)} className={`btn ${color === c ? 'btn-primary' : 'btn-secondary'}`}>{t(`play.${c}`)}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-2">{t('play.timeControl')}</div>
              <div className="flex flex-wrap gap-2">
                {TIME_CONTROLS.map((t2) => (
                  <button key={t2} onClick={() => setTc(t2)} className={`btn ${tc === t2 ? 'btn-primary' : 'btn-secondary'}`}>{t(`play.tc.${t2}`)}</button>
                ))}
              </div>
            </div>
            <button onClick={startBot} className="btn-primary w-full text-base"><Swords className="h-4 w-4" />{t('play.start')}</button>
          </div>
        )}

        {setupTab === 'friend' && <FriendTab onChallengeAccepted={(gid) => connectPvp(gid)} />}
      </div>
    );
  }

  if (phase === 'setup' && pvpGameId) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <Spinner size="lg" label={t('play.connecting')} />
      </div>
    );
  }

  // ---- PLAYING / OVER ----
  const showAlwaysCoach = user?.profile.coach_behavior === 'always_on_pedagogical' && coachConfigured;
  const lastMoveOnBoard = moves.length > 0 ? moves[moves.length - 1] : null;
  const lastMoveDestSquare = lastMoveOnBoard?.uci?.slice(2, 4);

  // Coach context: explain user's last classified move if available, else give a hint
  const moveSans = moves.map((m) => m.san);
  const coachReq = lastClassifiedMove ? () => ({
    url: '/api/coach/explain',
    body: {
      fen: lastClassifiedMove.fen_before,
      player: ((lastClassifiedMove.ply % 2) === 1 ? 'White' : 'Black'),
      played_san: lastClassifiedMove.san,
      best_san: lastClassifiedMove.best_san,
      classification: lastClassifiedMove.classification,
      cp_loss: lastClassifiedMove.cp_loss,
      pv_san: [],
      history: moveSans.slice(0, lastClassifiedMove.ply - 1),
      user_perspective: true,
    },
  }) : (turn === userColor && coachConfigured ? () => ({
    url: '/api/coach/hint',
    body: { fen, history: moveSans },
  }) : null);

  const oppLabel = opponent ? opponent.display_name : (userColor === 'white' ? t('play.black') : t('play.white'));
  const isPvP = !!pvpGameId;
  const oppDisconnected = isPvP && opponent && !opponent.online;

  const statusNode = isBrowsing ? <span className="font-medium text-amber-600">{t('play.browsingPast')}</span>
    : previewing ? <Spinner inline label={t('play.checking')} />
    : turn === userColor ? <span className="font-medium text-accent-600">{t('play.yourTurn')}</span>
    : <span className="text-ink-500">{t('play.thinking')}</span>;

  return (
    <div className="mx-auto max-w-7xl pb-24 lg:pb-0">
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* BOARD COLUMN — full width on lg+ (max 760px). The BOARD ELEMENT
            below uses aspect-square + a viewport-height-aware max-width so the
            board shrinks vertically on short screens without making the
            column itself narrow. */}
        <div className="mx-auto w-full lg:mx-0 lg:flex-1 lg:max-w-[760px]">
          <ClockBar timeMs={userColor === 'white' ? blackMs : whiteMs} active={turn !== userColor} label={oppLabel} flip />
          {oppDisconnected && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              {opponent?.display_name} disconnected — waiting for them to come back…
            </div>
          )}
          {isPvP && (drawOffer === 'them' || takeback === 'them' || (rematch === 'them' && phase === 'over')) && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-accent-500/40 bg-accent-500/10 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                {drawOffer === 'them' ? t('play.drawOfferedBy', { name: oppLabel })
                  : takeback === 'them' ? t('play.takebackRequestedBy', { name: oppLabel })
                  : t('play.rematchOfferedBy', { name: oppLabel })}
              </span>
              <button onClick={drawOffer === 'them' ? acceptDraw : takeback === 'them' ? acceptTakeback : acceptRematch} className="btn-primary h-9 px-3 text-sm"><Check className="h-4 w-4" />{t('challenge.accept')}</button>
              <button onClick={drawOffer === 'them' ? declineDraw : takeback === 'them' ? declineTakeback : declineRematch} className="btn-secondary h-9 px-3 text-sm"><X className="h-4 w-4" />{t('challenge.decline')}</button>
            </div>
          )}
          {isPvP && phase === 'playing' && (drawOffer === 'me' || takeback === 'me') && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-500 dark:border-ink-700 dark:bg-ink-800/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {drawOffer === 'me' ? t('play.drawOffered') : t('play.takebackRequested')}
            </div>
          )}
          <div className="my-1 flex items-center justify-between gap-2">
            <CapturedPieces fen={fen} side={userColor === 'white' ? 'black' : 'white'} />
          </div>
          <div className="my-2 flex justify-center">
            {/* `aspect-square` + `lg:max-w-[calc(100vh-26rem)]` shrinks the
                board to fit the viewport height (chrome ≈ 17rem inside column
                + ≈ 9rem outside) without narrowing the surrounding column.
                Position:relative here so the badge children are anchored to
                the board, not the outer flex container. */}
            <div
              className={`relative aspect-square w-full min-w-0 board-theme-${user?.profile.board_theme ?? 'wood'} lg:max-w-[calc(100vh-26rem)]`}
            >
              <ChessBoard
                fen={displayedFen}
                orientation={orientation}
                movable={movable}
                turnColor={turn}
                onMove={attemptMove}
                lastMove={displayedLastMove as never}
                arrows={isBrowsing ? [] : (boardArrows as never[])}
                resetKey={boardKey}
              />
              {/* Living pieces (kid mode) — emoji moods over each of the
                  viewer's pieces. Gated on profile flag + audience='kid' so
                  it only activates for accounts set up for kids. Hidden
                  during browse mode to avoid confusing "are these the moods
                  for past-position or current?". */}
              {user?.profile.audience === 'kid' && user?.profile.kid_piece_emotions && !isBrowsing && (
                <PieceEmotionsOverlay
                  fen={displayedFen}
                  viewerColor={userColor}
                  orientation={orientation}
                />
              )}
              {/* Classification badge for the last classified user move (bot mode only).
                  Hidden while browsing past positions. */}
              {!isBrowsing && lastClassifiedMove && lastMoveDestSquare === lastClassifiedMove.uci.slice(2, 4) && (
                <ClassificationBadge classification={lastClassifiedMove.classification} square={lastClassifiedMove.uci.slice(2, 4)} orientation={orientation} />
              )}
              {/* Subtle "browsing past position" overlay tag */}
              {isBrowsing && (
                <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-semibold text-white shadow-lift">
                  {t('play.browsingPast')}
                </div>
              )}
            </div>
          </div>
          <div className="my-1 flex items-center justify-between gap-2">
            <CapturedPieces fen={fen} side={userColor} />
          </div>
          <ClockBar timeMs={userColor === 'white' ? whiteMs : blackMs} active={turn === userColor} label={user?.profile.display_name ?? (userColor === 'white' ? t('play.white') : t('play.black'))} />

          {/* Rewind nav — visible once at least one move has been played */}
          {phase !== 'setup' && positions.length > 1 && (
            <div className="mt-3 hidden items-center justify-center gap-1.5 sm:gap-2 lg:flex">
              <button onClick={() => setBrowseIndex(0)} disabled={(browseIndex ?? liveIndex) === 0} className="btn-secondary h-10 w-10 p-0 sm:h-11 sm:w-11" title={t('play.rewindFirst')}><ChevronsLeft className="h-5 w-5" /></button>
              <button onClick={stepBack} disabled={(browseIndex ?? liveIndex) === 0} className="btn-secondary h-10 w-10 p-0 sm:h-11 sm:w-11" title={t('play.rewindPrev')}><ChevronLeft className="h-5 w-5" /></button>
              <div className="flex h-10 min-w-[5rem] items-center justify-center rounded-xl bg-ink-100 px-3 font-mono text-sm tabular-nums dark:bg-ink-800 sm:h-11 sm:min-w-[5.5rem]">
                {(browseIndex ?? liveIndex)} / {liveIndex}
              </div>
              <button onClick={stepForward} disabled={!isBrowsing} className="btn-secondary h-10 w-10 p-0 sm:h-11 sm:w-11" title={t('play.rewindNext')}><ChevronRight className="h-5 w-5" /></button>
              <button onClick={goToLive} disabled={!isBrowsing} className={`h-10 px-3 text-sm sm:h-11 sm:px-4 ${isBrowsing ? 'btn-primary' : 'btn-secondary'}`} title={t('play.rewindLive')}>
                {isBrowsing ? <><Radio className="h-4 w-4" />{t('play.rewindLive')}</> : <ChevronsRight className="h-5 w-5" />}
              </button>
            </div>
          )}

          {phase === 'playing' && (
            <div className="mt-3 hidden flex-wrap items-center justify-between gap-2 lg:flex">
              <div className="text-sm">{statusNode}</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setFlipped((f) => !f)} className="btn-secondary h-11 px-3 text-sm sm:px-4" title={t('play.flip', { defaultValue: 'Flip board' })}>
                  <FlipVertical2 className="h-4 w-4" />
                </button>
                {isPvP && (
                  <>
                    <button onClick={offerDraw} disabled={drawOffer !== null} className="btn-secondary h-11 px-3 text-sm sm:px-4" title={t('play.offerDraw')}>
                      <Handshake className="h-4 w-4" />{t('play.offerDraw')}
                    </button>
                    <button onClick={requestTakeback} disabled={takeback !== null || moves.length === 0} className="btn-secondary h-11 px-3 text-sm sm:px-4" title={t('play.takeback')}>
                      <Undo2 className="h-4 w-4" />{t('play.takeback')}
                    </button>
                  </>
                )}
                <button onClick={requestHint} disabled={hintLoading || isBrowsing} className="btn-secondary h-11 px-3 text-sm sm:px-4">
                  {hintLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                  {t('play.hint')}
                </button>
                <button onClick={resign} className="btn-danger h-11 px-3 text-sm sm:px-4"><Flag className="h-4 w-4" />{t('play.resign')}</button>
              </div>
            </div>
          )}
          {/* Phone: one-line status under the board; everything else lives in the sticky bar. */}
          {phase === 'playing' && <div className="mt-2 text-center text-sm lg:hidden">{statusNode}</div>}
        </div>

        {/* SIDE PANEL — on phones the move list moves into the bottom sheet;
            the coach and the post-game pill stay in the flow. */}
        <div className="flex-1 space-y-3 lg:w-[360px] lg:flex-initial lg:max-w-md">
          {showAlwaysCoach && coachReq && (
            <CoachPanel
              systemConfigured={coachConfigured}
              request={coachReq}
              autoPlay
              triggerKey={`${lastClassifiedMove?.ply ?? 'h'}-${moves.length}`}
              debounceMs={500}
            />
          )}

          <div className="card hidden max-h-72 overflow-auto p-4 lg:block">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-chesscom-500">{t('review.moves')}</h3>
            <MovesList moves={moves} />
          </div>

          {/* Compact pill in side panel after the user dismisses the modal — lets
              them re-open it later without having to leave the page. */}
          <AnimatePresence>
            {phase === 'over' && result && gameOverDismissed && (
              <motion.button
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                onClick={() => setGameOverDismissed(false)}
                className="card-hover w-full p-3 text-left"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">
                    {result.result === '1/2-1/2' ? `½ ½ ${t('play.result.draw')}`
                      : (result.result === '1-0' && userColor === 'white') || (result.result === '0-1' && userColor === 'black') ? `🏆 ${t('play.result.win')}`
                      : `🤝 ${t('play.result.loss')}`}
                  </span>
                  <span className="text-xs text-ink-500">{t('play.showResult')}</span>
                </div>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* PHONE ACTION BAR — sticky, safe-area aware. Holds everything a
          thumb needs mid-game so the board can take the full width above. */}
      {phase !== 'setup' && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur dark:border-ink-700 dark:bg-ink-900/95 lg:hidden"
             style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="mx-auto flex max-w-7xl items-center gap-1.5 px-2 py-2">
            <button onClick={stepBack} disabled={(browseIndex ?? liveIndex) === 0} className="btn-secondary h-11 w-11 shrink-0 p-0" title={t('play.rewindPrev')}><ChevronLeft className="h-5 w-5" /></button>
            <button onClick={isBrowsing ? stepForward : goToLive} disabled={!isBrowsing} className={`h-11 w-11 shrink-0 p-0 ${isBrowsing ? 'btn-primary' : 'btn-secondary'}`} title={isBrowsing ? t('play.rewindNext') : t('play.rewindLive')}>
              {isBrowsing ? <ChevronRight className="h-5 w-5" /> : <Radio className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setSheetOpen(true)}
              onPointerDown={handleMovesPointerDown}
              onPointerUp={handleMovesPointerUp}
              onPointerCancel={() => { movesTouchStartY.current = null; }}
              className="btn-secondary h-11 min-w-0 flex-1 px-2 text-sm"
              title={reduceMotion ? undefined : 'Swipe up to open moves'}
            >
              <ListOrdered className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('review.moves')}</span>
              <span className="ml-1 rounded-full bg-ink-100 px-1.5 text-[11px] tabular-nums dark:bg-ink-800">{moves.length}</span>
            </button>
            {phase === 'playing' && (
              <button onClick={requestHint} disabled={hintLoading || isBrowsing} className="btn-secondary h-11 w-11 shrink-0 p-0" title={t('play.hint')}>
                {hintLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lightbulb className="h-5 w-5" />}
              </button>
            )}
            {isPvP && phase === 'playing' ? (
              <div className="relative shrink-0">
                <button onClick={() => setMoreOpen((o) => !o)} className="btn-secondary h-11 w-11 p-0" title={t('play.more', { defaultValue: 'More' })}><MoreHorizontal className="h-5 w-5" /></button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-[41]" onClick={() => setMoreOpen(false)} />
                    <div className="absolute bottom-full right-0 z-[42] mb-2 w-52 space-y-1 rounded-xl border border-ink-200 bg-white p-1.5 shadow-lift dark:border-ink-700 dark:bg-ink-900">
                      <button onClick={() => { setMoreOpen(false); setFlipped((f) => !f); }} className="btn-ghost h-10 w-full justify-start px-3 text-sm"><FlipVertical2 className="h-4 w-4" />{t('play.flip')}</button>
                      <button onClick={() => { setMoreOpen(false); offerDraw(); }} disabled={drawOffer !== null} className="btn-ghost h-10 w-full justify-start px-3 text-sm"><Handshake className="h-4 w-4" />{t('play.offerDraw')}</button>
                      <button onClick={() => { setMoreOpen(false); requestTakeback(); }} disabled={takeback !== null || moves.length === 0} className="btn-ghost h-10 w-full justify-start px-3 text-sm"><Undo2 className="h-4 w-4" />{t('play.takeback')}</button>
                      <button onClick={() => { setMoreOpen(false); resign(); }} className="btn-ghost h-10 w-full justify-start px-3 text-sm text-bad"><Flag className="h-4 w-4" />{t('play.resign')}</button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <button onClick={() => setFlipped((f) => !f)} className="btn-secondary h-11 w-11 shrink-0 p-0" title={t('play.flip', { defaultValue: 'Flip board' })}><FlipVertical2 className="h-5 w-5" /></button>
                {phase === 'playing' && (
                  <button onClick={resign} className="btn-danger h-11 w-11 shrink-0 p-0" title={t('play.resign')}><Flag className="h-5 w-5" /></button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* PHONE MOVES SHEET — tap or swipe to open; drag the handle/header down to dismiss. */}
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[45] bg-black/40 lg:hidden"
              onClick={() => setSheetOpen(false)}
            />
            <motion.div
              initial={{ y: reduceMotion ? 0 : '100%' }}
              animate={{ y: 0 }}
              exit={{ y: reduceMotion ? 0 : '100%' }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 36 }}
              drag={reduceMotion ? false : 'y'}
              dragControls={sheetDragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.45 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 80 || info.velocity.y > 500) setSheetOpen(false);
              }}
              className="fixed inset-x-0 bottom-0 z-[46] max-h-[70vh] rounded-t-2xl bg-white shadow-lift dark:bg-ink-900 lg:hidden"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              <button
                onClick={() => setSheetOpen(false)}
                onPointerDown={(event) => startSheetDrag(event)}
                className="flex w-full flex-col items-center pt-2 touch-none"
                aria-label={t('common.close', { defaultValue: 'Close' })}
              >
                <span className="h-1.5 w-10 rounded-full bg-ink-300 dark:bg-ink-600" />
              </button>

              <div
                className="flex items-center justify-between px-4 pb-2 pt-1 touch-none"
                onPointerDown={(event) => {
                  if (!(event.target as HTMLElement).closest('button')) startSheetDrag(event);
                }}
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-chesscom-500">{t('review.moves')}</h3>
                <button
                  onClick={() => setSheetOpen(false)}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="btn-ghost h-8 px-2 text-xs"
                >
                  {t('common.close', { defaultValue: 'Close' })}
                </button>
              </div>

              <div className="max-h-[calc(70vh-4rem)] overflow-y-auto px-4 pb-4">
                <MovesList moves={moves} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* BLUNDER WARNING MODAL */}
      <AnimatePresence>
        {blunder && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 p-4 sm:items-center">
            <motion.div initial={{ y: 20, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.95 }}
              className="card w-full max-w-md overflow-hidden shadow-lift">
              <div className="flex items-center gap-3 border-b border-ink-100 bg-bad/10 px-5 py-3 dark:border-ink-700">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bad/15 text-bad">
                  <X className="h-4 w-4" />
                </div>
                <div className="font-semibold">{t(`play.warn.${blunder.classification}`, { defaultValue: t('play.warn.mistake') })}</div>
              </div>
              <div className="space-y-3 p-5 text-sm">
                <p>{t('play.warnHelp')}</p>
                {blunder.best_san && <p className="text-ink-500">{t('play.warnHint', { move: blunder.best_san })}</p>}
                <div className="flex gap-2">
                  <button onClick={tryAnotherMove} className="btn-primary flex-1">{t('play.tryAnother')}</button>
                  <button onClick={() => commitMove(blunder.uci)} className="btn-secondary flex-1">{t('play.playAnyway')}</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* GAME OVER MODAL */}
      <AnimatePresence>
        {phase === 'over' && result && !gameOverDismissed && (() => {
          const isDraw = result.result === '1/2-1/2';
          const isWin = (result.result === '1-0' && userColor === 'white') || (result.result === '0-1' && userColor === 'black');
          const headerClass = isWin
            ? 'border-accent-500/30 bg-accent-500/10 text-accent-700 dark:text-accent-300'
            : isDraw
              ? 'border-ink-300 bg-ink-100 text-ink-700 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200'
              : 'border-bad/30 bg-bad/10 text-bad';
          const headline = isDraw ? t('play.result.draw') : isWin ? t('play.result.win') : t('play.result.loss');
          const emoji = isDraw ? '½ ½' : isWin ? '🏆' : '🤝';
          return (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setGameOverDismissed(true)}
              className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
            >
              <motion.div
                initial={{ y: 24, scale: 0.92, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 280, damping: 26 } }}
                exit={{ y: 24, scale: 0.92, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="card w-full max-w-md overflow-hidden shadow-lift"
              >
                <div className={`relative flex items-center gap-3 border-b px-5 py-4 ${headerClass}`}>
                  <div className="text-3xl leading-none">{emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xl font-bold leading-tight">{headline}</div>
                    <div className="mt-0.5 text-xs opacity-80">{t(`play.reason.${result.reason}`, { defaultValue: result.reason })}</div>
                  </div>
                  <button
                    onClick={() => setGameOverDismissed(true)}
                    className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-black/5 dark:hover:bg-white/10"
                    title={t('common.cancel')}
                  ><X className="h-4 w-4" /></button>
                </div>
                <div className="space-y-3 p-5">
                  <p className="text-sm text-ink-600 dark:text-ink-300">{t('play.overPrompt')}</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {isPvP ? (
                      rematch === 'them' ? (
                        <button onClick={acceptRematch} className="btn-primary flex-1">
                          <RefreshCw className="h-4 w-4" />{t('play.acceptRematch')}
                        </button>
                      ) : rematch === 'me' ? (
                        <button disabled className="btn-primary flex-1">
                          <Loader2 className="h-4 w-4 animate-spin" />{t('play.rematchOffered')}
                        </button>
                      ) : (
                        <button onClick={offerRematch} className="btn-primary flex-1" title={rematchDeclined ? t('play.rematchDeclined') : undefined}>
                          <RefreshCw className="h-4 w-4" />{t('play.rematch')}
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => { setPhase('setup'); resetGameState(); }}
                        className="btn-primary flex-1"
                      >
                        <Swords className="h-4 w-4" />{t('play.playAgain')}
                      </button>
                    )}
                    {result.gameId ? (
                      <button onClick={() => nav(`/review/${result.gameId}`)} className="btn-secondary flex-1">
                        <Sparkles className="h-4 w-4" />{t('play.review')}
                      </button>
                    ) : (
                      <button disabled className="btn-secondary flex-1" title={t('play.saving')}>
                        <Loader2 className="h-4 w-4 animate-spin" />{t('play.saving')}
                      </button>
                    )}
                  </div>
                  {isPvP && rematchDeclined && rematch === null && (
                    <p className="text-center text-xs text-ink-500">{t('play.rematchDeclined')}</p>
                  )}
                  {isPvP && (
                    <button onClick={() => { try { wsRef.current?.close(); } catch { /* ignore */ } setPhase('setup'); resetGameState(); nav('/play'); }} className="btn-ghost w-full text-xs text-ink-500">
                      <Swords className="h-3.5 w-3.5" />{t('play.playAgain')}
                    </button>
                  )}
                  <button
                    onClick={() => setGameOverDismissed(true)}
                    className="btn-ghost w-full text-xs text-ink-500"
                  >
                    {t('play.keepLooking')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors
      ${active ? 'bg-chesscom-900 text-white dark:bg-chesscom-100 dark:text-chesscom-900' : 'bg-chesscom-100 text-chesscom-700 hover:bg-chesscom-200 dark:bg-chesscom-800 dark:text-chesscom-200 dark:hover:bg-chesscom-700'}`}>
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}

function FriendTab({ onChallengeAccepted }: { onChallengeAccepted: (gameId: number) => void }) {
  const { t } = useTranslation();
  const lobby = useLobby();
  const { user } = useAuth();
  const [color, setColor] = useState<'white' | 'black' | 'random'>('random');
  const [tc, setTc] = useState<typeof TIME_CONTROLS[number]>('rapid');
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Sort: online first, then by name
  const users = useMemo(() => {
    const onlineSet = lobby.online;
    return [...lobby.users].sort((a, b) => {
      const ao = onlineSet.has(a.id) ? 1 : 0; const bo = onlineSet.has(b.id) ? 1 : 0;
      if (ao !== bo) return bo - ao;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [lobby.users, lobby.online]);

  async function sendChallenge() {
    if (!target) return;
    setBusy(true);
    try {
      await api.post('/api/challenges', { to_user_id: target, color, time_control: tc });
      await lobby.refreshChallenges();
    } finally { setBusy(false); }
  }
  async function cancel(id: number) {
    await api.del(`/api/challenges/${id}`);
    await lobby.refreshChallenges();
  }
  async function accept(id: number) {
    const r = await api.post<{ game_id: number }>(`/api/challenges/${id}/accept`);
    await lobby.refreshChallenges();
    onChallengeAccepted(r.game_id);
  }
  async function decline(id: number) {
    await api.post(`/api/challenges/${id}/decline`);
    await lobby.refreshChallenges();
  }

  return (
    <div className="space-y-4">
      {lobby.incoming.length > 0 && (
        <div className="card overflow-hidden">
          <div className="section-header">
            <div className="section-icon bg-accent-500/15 text-accent-600"><Swords className="h-4 w-4" /></div>
            <div><div className="section-title">{t('challenge.incomingList')}</div></div>
          </div>
          <div className="divide-y divide-ink-100 dark:divide-ink-700">
            {lobby.incoming.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 text-sm">
                <span className="text-2xl">{c.from.avatar_emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{c.from.display_name}</div>
                  <div className="text-xs text-ink-500">{t(`play.${c.color}`)} · {t(`play.tc.${c.time_control}`)}</div>
                </div>
                <button onClick={() => decline(c.id)} className="btn-ghost p-2"><X className="h-4 w-4" /></button>
                <button onClick={() => accept(c.id)} className="btn-primary text-xs"><Check className="h-4 w-4" />{t('challenge.accept')}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {lobby.outgoing.length > 0 && (
        <div className="card overflow-hidden">
          <div className="section-header">
            <div className="section-icon bg-amber-500/15 text-amber-600"><Loader2 className="h-4 w-4 animate-spin" /></div>
            <div><div className="section-title">{t('challenge.waiting')}</div></div>
          </div>
          <div className="divide-y divide-ink-100 dark:divide-ink-700">
            {lobby.outgoing.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 text-sm">
                <span className="text-2xl">{c.to.avatar_emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{c.to.display_name}</div>
                  <div className="text-xs text-ink-500">{t(`play.${c.color}`)} · {t(`play.tc.${c.time_control}`)}</div>
                </div>
                <button onClick={() => cancel(c.id)} className="btn-secondary text-xs">{t('common.cancel')}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="section-header">
          <div className="section-icon bg-purple-500/15 text-purple-600"><UsersIcon className="h-4 w-4" /></div>
          <div>
            <div className="section-title">{t('challenge.players')}</div>
            <div className="section-desc">{t('challenge.playersDesc')}</div>
          </div>
        </div>
        <div className="space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="label mb-1">{t('play.color')}</div>
              <div className="grid grid-cols-3 gap-1">
                {(['white','random','black'] as const).map((c) => (
                  <button key={c} onClick={() => setColor(c)} className={`btn text-xs ${color === c ? 'btn-primary' : 'btn-secondary'}`}>{t(`play.${c}`)}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-1">{t('play.timeControl')}</div>
              <select className="input" value={tc} onChange={(e) => setTc(e.target.value as typeof TIME_CONTROLS[number])}>
                {TIME_CONTROLS.map((tt) => <option key={tt} value={tt}>{t(`play.tc.${tt}`)}</option>)}
              </select>
            </div>
          </div>
          {users.length === 0 ? (
            <div className="rounded-xl bg-ink-100 p-4 text-center text-sm text-ink-500 dark:bg-ink-800">
              {t('challenge.noPlayers')}
            </div>
          ) : (
            <div className="max-h-72 space-y-1 overflow-auto">
              {users.map((u) => (
                <button key={u.id} onClick={() => setTarget(u.id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors
                    ${target === u.id ? 'bg-chesscom-900 text-white dark:bg-chesscom-100 dark:text-chesscom-900' : 'hover:bg-chesscom-100 dark:hover:bg-chesscom-800'}`}>
                  <span className="text-xl">{u.avatar_emoji}</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{u.display_name}</div>
                    <div className="text-xs opacity-70">@{u.username}</div>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${u.online ? 'bg-green-500' : 'bg-chesscom-400/60'}`} title={u.online ? 'online' : 'offline'} />
                </button>
              ))}
            </div>
          )}
          <button onClick={sendChallenge} disabled={!target || busy} className="btn-primary w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
            {t('challenge.send')}
          </button>
        </div>
      </div>

      {void user}
    </div>
  );
}

function ClockBar({ timeMs, active, label, flip }: { timeMs: number; active: boolean; label: string; flip?: boolean }) {
  const low = active && timeMs > 0 && timeMs < 10_000;
  return (
    <div className={`flex items-center justify-between rounded-md px-4 py-2 transition-colors
      ${active
        ? (low ? 'bg-bad text-white animate-pulse-soft' : 'bg-green-500 text-white')
        : 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-800 dark:text-chesscom-300'} ${flip ? '' : ''}`}>
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      <span className="font-mono text-lg font-bold tabular-nums">{fmtClock(timeMs)}</span>
    </div>
  );
}

function MovesList({ moves }: { moves: Move[] }) {
  const rows: { num: number; w?: Move; b?: Move }[] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push({ num: i / 2 + 1, w: moves[i], b: moves[i + 1] });
  if (rows.length === 0) return <div className="text-sm text-chesscom-400">—</div>;
  return (
    <div className="grid grid-cols-[auto,1fr,1fr] gap-x-3 gap-y-1 text-sm">
      {rows.flatMap((r) => [
        <span key={`n${r.num}`} className="text-chesscom-400">{r.num}.</span>,
        <span key={`w${r.num}`}>{r.w?.san ?? ''}{r.w?.classification && <ClsGlyph c={r.w.classification} />}</span>,
        <span key={`b${r.num}`}>{r.b?.san ?? ''}{r.b?.classification && <ClsGlyph c={r.b.classification} />}</span>,
      ])}
    </div>
  );
}

function ClsGlyph({ c }: { c: Classification }) {
  const map: Record<Classification, string> = {
    brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '·', book: '📖',
    forced: '🔒', inaccuracy: '?!', mistake: '?', blunder: '??', miss: '✗',
  };
  const color: Record<Classification, string> = {
    brilliant: 'text-move-brilliant', great: 'text-move-great', best: 'text-move-best',
    excellent: 'text-move-excellent', good: 'text-move-good', book: 'text-move-book',
    forced: 'text-move-forced', inaccuracy: 'text-move-inaccuracy',
    mistake: 'text-move-mistake', blunder: 'text-move-blunder', miss: 'text-move-miss',
  };
  return <span className={`ml-1 text-[11px] font-bold ${color[c]}`}>{map[c]}</span>;
}
