import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Sparkles, Settings as SettingsIcon, Copy, Download, Check, ListOrdered, FileText, X, Star, Share2, FlipVertical2, NotebookPen, Search, Loader2 } from 'lucide-react';
import { Chess } from 'chess.js';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import CoachPanel from '../components/CoachPanel';
import GameReportCard, { type MovePick } from '../components/GameReportCard';
import MoveExplanation from '../components/MoveExplanation';
import GameReportPanel, { type GameReviewProse } from '../components/GameReportPanel';
import KeyMomentsList from '../components/KeyMomentsList';
import OpeningBanner from '../components/OpeningBanner';
import ClassificationBadge from '../components/ClassificationBadge';
import CapturedPieces from '../components/CapturedPieces';
import ThreatPanel from '../components/ThreatPanel';
import ExplorerPanel from '../components/ExplorerPanel';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import { api } from '../api';
import { withBusyRetry } from '../lib/busyRetry';
import { useAuth } from '../state/auth';
import { parseFromPosition, playFromPosition, playFromUrl } from '../lib/fromPosition';
import type { AnalysisResult, AnalyzedMove, KeyMomentSummary, PhaseSplit } from '../types';

interface GameDetail {
  game: { id: number; pgn: string; white: string; black: string; result: string; user_color: 'white' | 'black' | null; eco?: string | null; opening_name?: string | null; bookmarked?: number | null; notes?: string | null; start_fen?: string | null };
  analysis: {
    depth: number; accuracy_white: number; accuracy_black: number;
    estimated_elo_white: number | null; estimated_elo_black: number | null;
    performance_white: number | null; performance_black: number | null;
    opening_eco: string | null; opening_name: string | null;
    key_moments_json: string | null;
    phase_split_json: string | null;
    moves_json: string;
  } | null;
  analysis_stale?: boolean;
}

interface EngineLine {
  uci: string;
  san: string;
  pv_san: string[];
  cp: number | null;
  mate: number | null;
  multipv: number;
}

function fmtCp(cp: number | null | undefined): string {
  if (cp == null) return '0.00';
  if (cp >= 9000) return '#';
  if (cp <= -9000) return '-#';
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

type Tab = 'moves' | 'report' | 'moments';

export default function GameAnalyzer() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const gameId = Number(id);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => api.get<GameDetail>(`/api/games/${gameId}`),
    enabled: !!gameId,
  });

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [coachConfigured, setCoachConfigured] = useState(false);
  const [requestedDepth, setRequestedDepth] = useState(16);
  const [showDepthControl, setShowDepthControl] = useState(false);
  const [reviewProse, setReviewProse] = useState<GameReviewProse | null>(null);
  const [tab, setTab] = useState<Tab>('moves');
  // A category picked in the Game Report table (e.g. Black's misses): those
  // moves stand out in the move list and the arrows below step through them.
  const [pick, setPick] = useState<MovePick | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  // Local UI state for new features.
  const [flipped, setFlipped] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (!data) return;
    if (data.analysis) {
      const a = data.analysis;
      setAnalysis({
        depth: a.depth,
        accuracy_white: a.accuracy_white,
        accuracy_black: a.accuracy_black,
        estimated_elo_white: a.estimated_elo_white,
        estimated_elo_black: a.estimated_elo_black,
        performance_white: a.performance_white ?? null,
        performance_black: a.performance_black ?? null,
        opening_eco: a.opening_eco,
        opening_name: a.opening_name,
        key_moments: a.key_moments_json ? (JSON.parse(a.key_moments_json) as KeyMomentSummary[]) : [],
        phase_split: a.phase_split_json ? (JSON.parse(a.phase_split_json) as PhaseSplit) : null,
        moves: JSON.parse(a.moves_json) as AnalyzedMove[],
      });
      setRequestedDepth(Math.max(16, a.depth));
    } else {
      setAnalysis(null);
    }
    if (data.analysis_stale && !analyzing) {
      void analyze(16, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Load any cached AI prose for this game
  useEffect(() => {
    if (!gameId) return;
    api.get<{ review: GameReviewProse | null }>(`/api/games/${gameId}/review`)
      .then((r) => setReviewProse(r.review))
      .catch(() => setReviewProse(null));
  }, [gameId]);

  useEffect(() => {
    api.get<{ configured: boolean }>('/api/coach/status')
      .then((s) => setCoachConfigured(s.configured))
      .catch(() => setCoachConfigured(false));
  }, []);

  const positions = useMemo(() => {
    if (!data) return [];
    const chess = new Chess();
    chess.loadPgn(data.game.pgn, { strict: false });
    const history = chess.history({ verbose: true });
    // A game played from a position starts there, not at the opening.
    const headers = chess.getHeaders();
    const replay = new Chess(headers.SetUp === '1' && headers.FEN ? headers.FEN : undefined);
    const list: { fen: string; san?: string; from?: string; to?: string; uci?: string }[] = [{ fen: replay.fen() }];
    for (const m of history) {
      replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      list.push({ fen: replay.fen(), san: m.san, from: m.from, to: m.to, uci: m.from + m.to + (m.promotion ?? '') });
    }
    return list;
  }, [data]);

  // Read initial ?ply= from the URL so deep-links to a specific position
  // open at that move on first render. After that we keep them in sync.
  const initialPly = (() => {
    const v = Number(searchParams.get('ply'));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  })();
  const [ply, setPly] = useState(initialPly);

  useEffect(() => { setPly(initialPly); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [gameId]);

  // Keep ?ply= in the URL so refresh + share work. Replace, don't push.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (ply > 0) next.set('ply', String(ply)); else next.delete('ply');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply]);

  const prevPlyRef = useRef(ply);
  useEffect(() => {
    if (ply === prevPlyRef.current) return;
    if (ply > 0 && positions[ply]?.san) {
      const flags = inferMoveFlagsFromSan(positions[ply]!.san!);
      soundForMove(flags);
    }
    prevPlyRef.current = ply;
  }, [ply, positions]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(positions.length - 1, p + 1));
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(positions.length - 1);
      else if (e.key === 'f' || e.key === 'F') setFlipped((f) => !f);
      else if (e.key === 's' || e.key === 'S') {
        const url = window.location.href;
        navigator.clipboard?.writeText(url).then(() => {
          setLinkCopied(true);
          setTimeout(() => setLinkCopied(false), 1400);
        }).catch(() => undefined);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [positions.length]);

  async function analyze(depth: number, force = false) {
    setAnalyzing(true);
    try {
      const r = await api.post<{ analysis: AnalysisResult; cached: boolean }>('/api/analyze', { game_id: gameId, depth, force });
      setAnalysis(r.analysis);
      await refetch();
    } finally {
      setAnalyzing(false);
    }
  }

  // Top engine lines panel (multiPV) — fetched on demand, debounced when enabled.
  // These hooks live BEFORE the loading early-return below so hook order stays
  // stable across the loading → loaded transition (React error #310).
  const [linesEnabled, setLinesEnabled] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState(false);
  const [linesHover, setLinesHover] = useState<EngineLine | null>(null);
  const [explorerHover, setExplorerHover] = useState<string | null>(null);
  const pos = data ? (positions[ply] ?? positions[0]) : undefined;
  const currentFen = pos?.fen ?? '';
  useEffect(() => {
    if (!linesEnabled || !currentFen) return;
    let cancelled = false;
    setLinesError(false);
    setLinesLoading(true);
    const handle = window.setTimeout(() => {
      // Single-flight per user: the threat panel may hold the engine — retry a 429 (#89).
      withBusyRetry(() => api.post<{ fen: string; depth: number; lines: EngineLine[] }>('/api/analyze/position', { fen: currentFen, depth: 18, lines: 3 }), () => cancelled)
        .then((r) => { if (!cancelled) { setLines(r.lines ?? []); setLinesLoading(false); } })
        .catch(() => { if (!cancelled) { setLinesError(true); setLinesLoading(false); setLines([]); } });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [linesEnabled, currentFen]);

  if (isLoading || !data) return <AnalyzerSkeleton />;

  const move: AnalyzedMove | undefined = analysis?.moves[ply - 1];
  const userColor = data.game.user_color ?? 'white';
  // "Play from here" (in the move card): the position on the board, at any
  // move — you keep your colour and Patzer takes the other side. To redo a
  // slip, you pick the move before it. Not once the game is over.
  const playOnFrom = playFromPosition(positions, ply + 1);
  const playOnColor = data.game.user_color ?? undefined;
  const playOn = playOnFrom && parseFromPosition(playOnFrom.fen, playOnFrom.moves.join(','), playOnColor ?? null)
    ? playFromUrl(playOnFrom, playOnColor) : null;
  const orientation: 'white' | 'black' = flipped
    ? (userColor === 'white' ? 'black' : 'white')
    : userColor;
  const currentEvalCp = move?.eval_after_cp ?? 0;

  const historySoFar = analysis?.moves.slice(0, ply - 1).map((m) => m.san) ?? [];
  const coachReq = move ? () => ({
    url: '/api/coach/explain',
    body: {
      fen: move.fen_before,
      player: ply % 2 === 1 ? 'White' : 'Black',
      played_san: move.san,
      best_san: move.best_move_san,
      classification: move.classification,
      cp_loss: move.centipawn_loss,
      // Sending eval before/after lets the server build win-probability and
      // a natural-language eval state into FACTS — strong grounding so a
      // small local model stops inventing winning attacks from training data.
      eval_before_cp: move.eval_before_cp,
      eval_after_cp: move.eval_after_cp,
      pv_san: move.best_pv,
      history: historySoFar,
      // Your own moves get "you" and your history (past mistakes of the same
      // kind, weakest phase, the opening trainer); the opponent's get neither.
      user_perspective: !!data.game.user_color && (ply % 2 === 1 ? 'white' : 'black') === data.game.user_color,
    },
  }) : null;

  const baseArrow = move?.best_move_uci && move.best_move_uci !== move.uci ? [{
    orig: move.best_move_uci.slice(0, 2) as never,
    dest: move.best_move_uci.slice(2, 4) as never,
    brush: 'paleBlue',
  }] : [];
  const hoverUci = linesHover?.uci ?? explorerHover;
  const hoverArrow = hoverUci ? [{
    orig: hoverUci.slice(0, 2) as never,
    dest: hoverUci.slice(2, 4) as never,
    brush: 'paleGreen',
  }] : [];
  const arrow = [...baseArrow, ...hoverArrow];

  const pickedPlies = pick && analysis
    ? analysis.moves
      .filter((m) => m.classification === pick.classification && (pick.side === 'both' || (m.ply % 2 === 1 ? 'white' : 'black') === pick.side))
      .map((m) => m.ply)
    : [];
  const pickedSet = pick ? new Set(pickedPlies) : null;
  const pickIndex = pickedPlies.indexOf(ply);
  const stepPick = (dir: 1 | -1) => {
    if (pickedPlies.length === 0) return;
    // From a move outside the category, go to the nearest one in that direction.
    const next = dir === 1
      ? (pickedPlies.find((p) => p > ply) ?? pickedPlies[0]!)
      : ([...pickedPlies].reverse().find((p) => p < ply) ?? pickedPlies[pickedPlies.length - 1]!);
    setPly(next);
  };
  const onPick = (p: MovePick) => {
    if (pick && pick.classification === p.classification && pick.side === p.side) { setPick(null); return; }
    setPick(p);
    setTab('moves');
    const first = analysis?.moves.find((m) => m.classification === p.classification && (p.side === 'both' || (m.ply % 2 === 1 ? 'white' : 'black') === p.side));
    if (first) setPly(first.ply);
    // Bring the move list into view inside the right rail.
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const eco = analysis?.opening_eco ?? data.game.eco ?? null;
  const openingName = analysis?.opening_name ?? data.game.opening_name ?? null;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link to="/review" className="btn-ghost text-sm shrink-0"><ChevronLeft className="h-4 w-4" />{t('common.back')}</Link>
        <div className="min-w-0 truncate text-right text-sm text-chesscom-500">
          <span className="font-medium text-chesscom-900 dark:text-chesscom-100">{data.game.white}</span> vs{' '}
          <span className="font-medium text-chesscom-900 dark:text-chesscom-100">{data.game.black}</span>
          <span className="ml-2">· {data.game.result}</span>
          {data.game.start_fen && <span className="ml-2 rounded-full bg-chesscom-100 px-2 py-0.5 text-[11px] dark:bg-chesscom-800">{t('review.fromPosition')}</span>}
        </div>
      </div>

      {/* Workspace fits the fold on lg+: the flex row is capped by viewport
          height; right rail scrolls inside itself (`overflow-y-auto` + `min-h-0`).
          Page-level scroll is eliminated. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-5 lg:max-h-[calc(100vh-11rem)] lg:overflow-hidden">
        {/* BOARD COLUMN — column itself is wide (max 760px). The BOARD element
            is what's capped by viewport height (aspect-square keeps it square
            while the height limit shrinks both dimensions). The eval graph
            moved into the right rail to leave more vertical room here. */}
        <div className="mx-auto w-full lg:mx-0 lg:flex-1 lg:max-w-[760px]">
          <PlayerHeader
            name={orientation === 'white' ? data.game.black : data.game.white}
            accuracy={orientation === 'white' ? analysis?.accuracy_black : analysis?.accuracy_white}
            elo={orientation === 'white' ? analysis?.estimated_elo_black : analysis?.estimated_elo_white}
            side={orientation === 'white' ? 'black' : 'white'}
            fen={pos?.fen ?? ''}
          />
          {/* Board sized so column fits in the workspace height. Chrome math:
              workspace chrome (header + breadcrumb + page padding + footer) ≈
              11rem; board-column chrome (top header + bottom header + eval row +
              step controls) ≈ 13rem. Board side ≤ 100vh − 24rem keeps the whole
              column flush. `aspect-square` makes height = width. */}
          <div className="relative my-2 flex items-stretch justify-center gap-2">
            <EvalBar cp={currentEvalCp} orientation={orientation} />
            <div
              className={`relative aspect-square w-full min-w-0 board-theme-${user?.profile.board_theme ?? 'green'} lg:max-w-[calc(100vh-24rem)]`}
            >
              <ChessBoard
                fen={pos?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}
                orientation={orientation}
                lastMove={pos?.from && pos?.to ? [pos.from as never, pos.to as never] : undefined}
                arrows={arrow as never[]}
              />
              {move && pos?.to && (
                <ClassificationBadge classification={move.classification} square={pos.to} orientation={orientation} />
              )}
            </div>
          </div>
          <PlayerHeader
            name={orientation === 'white' ? data.game.white : data.game.black}
            accuracy={orientation === 'white' ? analysis?.accuracy_white : analysis?.accuracy_black}
            elo={orientation === 'white' ? analysis?.estimated_elo_white : analysis?.estimated_elo_black}
            side={orientation}
            fen={pos?.fen ?? ''}
            highlighted
          />

          <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-soft dark:bg-chesscom-800">
            <div className="min-w-0 truncate text-chesscom-500">
              {move ? (
                <>
                  <span className="font-medium text-chesscom-900 dark:text-chesscom-100">{ply % 2 === 1 ? t('review.sideShort.white') : t('review.sideShort.black')}: {move.san}</span>
                  {move.best_move_san && move.best_move_san !== move.san && (
                    <span className="ml-2 text-xs text-chesscom-400">{t('review.best', { san: move.best_move_san })}</span>
                  )}
                </>
              ) : <span className="italic">{t('review.startingPosition')}</span>}
            </div>
            <div className="font-mono text-base font-semibold tabular-nums">
              {fmtCp(currentEvalCp)}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5 sm:gap-2">
            <button onClick={() => setPly(0)} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.first')}><ChevronsLeft className="h-5 w-5" /></button>
            <button onClick={() => setPly((p) => Math.max(0, p - 1))} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.prev')}><ChevronLeft className="h-5 w-5" /></button>
            <div className="flex h-10 min-w-[5rem] items-center justify-center rounded-xl bg-chesscom-100 px-3 text-sm font-mono tabular-nums dark:bg-chesscom-800 sm:h-12 sm:min-w-[5.5rem]">
              {ply} / {positions.length - 1}
            </div>
            <button onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.next')}><ChevronRight className="h-5 w-5" /></button>
            <button onClick={() => setPly(positions.length - 1)} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.last')}><ChevronsRight className="h-5 w-5" /></button>
          </div>

        </div>

        {/* RIGHT RAIL — scrolls inside itself on lg+ so the page stays fixed.
            `min-h-0` lets the flex child shrink below content height; without it
            flex would force the page to grow. */}
        <div className="min-w-0 space-y-3 lg:w-[380px] lg:flex-initial lg:max-w-md lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {!analysis && (
            <button onClick={() => analyze(requestedDepth, false)} disabled={analyzing} className="btn-primary w-full">
              <Sparkles className="h-4 w-4" />
              {analyzing
                ? t('review.analyzing', { progress: '…' })
                : t('review.runEngine', { defaultValue: 'Run engine analysis' })}
            </button>
          )}

          {analysis && (
            <>
              <OpeningBanner eco={eco} name={openingName} prose={reviewProse?.opening?.prose} />

              {/* Eval graph lives here (moved from below the board) so the
                  board column stays short enough to fit the fold. */}
              <div className="card p-2">
                <EvalGraph
                  evals={analysis.moves.map((m) => ({ ply: m.ply, cp: m.eval_after_cp }))}
                  current={ply}
                  onClick={(p) => setPly(p)}
                  markers={analysis.moves
                    .filter((m) => ['blunder','mistake','inaccuracy','miss','brilliant','great'].includes(m.classification))
                    .map((m) => ({ ply: m.ply, classification: m.classification }))}
                />
              </div>

              <GameReportCard
                whiteName={data.game.white}
                blackName={data.game.black}
                accuracyW={analysis.accuracy_white}
                accuracyB={analysis.accuracy_black}
                eloW={analysis.estimated_elo_white}
                eloB={analysis.estimated_elo_black}
                perfW={analysis.performance_white}
                perfB={analysis.performance_black}
                moves={analysis.moves}
                phaseSplit={analysis.phase_split}
                userColor={userColor}
                onPick={onPick}
                picked={pick}
              />

              {showDepthControl && (
                <div className="card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="label">{t('review.depth')}</label>
                    <span className="font-mono text-sm font-semibold tabular-nums">{requestedDepth}</span>
                  </div>
                  <input
                    type="range" min={8} max={22} step={1}
                    value={requestedDepth}
                    onChange={(e) => setRequestedDepth(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-chesscom-400">
                    <span>{t('review.depthFast')}</span>
                    <span>{t('review.depthQuality')}</span>
                    <span>{t('review.depthDeep')}</span>
                  </div>
                  <button
                    onClick={() => analyze(requestedDepth, true)}
                    disabled={analyzing}
                    className="btn-primary mt-3 w-full text-sm"
                  >
                    <Sparkles className="h-4 w-4" />
                    {analyzing ? t('review.analyzing', { progress: '…' }) : `${t('review.reanalyze')} (depth ${requestedDepth})`}
                  </button>
                </div>
              )}

              {/* Tabbed workspace — Moves / AI report / Key moments / Engine / Coach.
                  This is the ONLY tabbed surface on the page: engine lines moved in
                  here (previously a peer card) so there is one mental model, not three. */}
              <div ref={tabsRef} className="card overflow-hidden scroll-mt-2">
                <div className="flex items-center gap-0.5 border-b border-chesscom-100 bg-chesscom-50/40 px-1 dark:border-chesscom-700 dark:bg-chesscom-900/40 sm:gap-1 sm:px-2">
                  <TabBtn active={tab === 'moves'} onClick={() => setTab('moves')} icon={ListOrdered} label={t('review.moves', { defaultValue: 'Moves' })} />
                  <TabBtn active={tab === 'report'} onClick={() => setTab('report')} icon={FileText} label={t('review.gameReport', { defaultValue: 'AI report' })} />
                  <TabBtn active={tab === 'moments'} onClick={() => setTab('moments')} icon={Sparkles} label={t('review.keyMoments', { defaultValue: 'Key moments' })} />
                  <button onClick={() => setShowDepthControl((s) => !s)} className="btn-ghost ml-auto p-1.5" title={t('review.depth')}>
                    <SettingsIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-3">
                  {tab === 'moves' && pick && (
                    <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-gold-500/40 bg-gold-50/60 px-2 py-1.5 text-xs dark:bg-gold-700/10">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">{t(`classification.${pick.classification}`)}</span>
                        <span className="text-chesscom-500"> · {pick.side === 'both' ? t('review.pickBoth', { defaultValue: 'both sides' }) : t(`review.${pick.side}`)}</span>
                      </span>
                      <span className="font-mono tabular-nums text-chesscom-500">{pickIndex >= 0 ? pickIndex + 1 : '–'}/{pickedPlies.length}</span>
                      <button onClick={() => stepPick(-1)} className="btn-ghost p-1" title={t('review.prev')}><ChevronLeft className="h-4 w-4" /></button>
                      <button onClick={() => stepPick(1)} className="btn-ghost p-1" title={t('review.next')}><ChevronRight className="h-4 w-4" /></button>
                      <button onClick={() => setPick(null)} className="btn-ghost p-1" title={t('common.close', { defaultValue: 'Close' })}><X className="h-4 w-4" /></button>
                    </div>
                  )}
                  {tab === 'moves' && move && (
                    <MoveExplanation
                      move={move}
                      userColor={data.game.user_color}
                      coachConfigured={coachConfigured}
                      coachRequest={coachReq}
                      playFrom={playOn ?? undefined}
                    />
                  )}
                  {tab === 'moves' && (
                    <MoveList
                      moves={analysis.moves.map((m) => ({ ply: m.ply, san: m.san, classification: m.classification }))}
                      current={ply}
                      onSelect={setPly}
                      phaseSplit={analysis.phase_split}
                      highlight={pickedSet}
                      maxHeight={typeof window !== 'undefined' && window.innerWidth < 768 ? 320 : 460}
                    />
                  )}
                  {tab === 'report' && (
                    <GameReportPanel
                      gameId={gameId}
                      initial={reviewProse}
                      onMomentJump={setPly}
                      onGenerated={setReviewProse}
                      userColor={data.game.user_color}
                    />
                  )}
                  {tab === 'moments' && (
                    <KeyMomentsList
                      items={analysis.key_moments.map((m) => {
                        const proseHit = reviewProse?.key_moments.find((p) => p.ply === m.ply);
                        return {
                          ply: m.ply,
                          side: m.side,
                          san: m.san,
                          classification: m.classification,
                          cp_loss: m.cp_loss,
                          win_pct_delta: m.win_pct_delta,
                          best_san: m.best_san,
                          title: proseHit?.title,
                          prose: proseHit?.prose,
                          mine: data.game.user_color ? m.side === data.game.user_color : undefined,
                        };
                      })}
                      current={ply}
                      onSelect={setPly}
                    />
                  )}
                </div>
              </div>

              <LinesPanel
                enabled={linesEnabled}
                onToggle={() => setLinesEnabled((s) => !s)}
                lines={lines}
                loading={linesLoading}
                error={linesError}
                playedUci={positions[ply + 1] ? (positions[ply + 1]!.from ?? '') + (positions[ply + 1]!.to ?? '') : null}
                onAdvance={() => setPly((p) => Math.min(positions.length - 1, p + 1))}
                onHover={setLinesHover}
              />

              <ThreatPanel fen={currentFen} currentCpWhite={currentEvalCp} />

              <ExplorerPanel fen={currentFen} onPreview={setExplorerHover} />

              <GameMetaToolbar
                gameId={gameId}
                bookmarked={!!data.game.bookmarked}
                notes={data.game.notes ?? ''}
                onFlip={() => setFlipped((f) => !f)}
                linkCopied={linkCopied}
                onShare={() => {
                  const url = window.location.href;
                  navigator.clipboard?.writeText(url).then(() => {
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 1400);
                  }).catch(() => undefined);
                }}
              />

              <ExportRow
                pgn={data.game.pgn}
                fen={pos?.fen ?? ''}
                fileBase={`${(data.game.white || 'white').replace(/[^A-Za-z0-9]+/g, '_')}_vs_${(data.game.black || 'black').replace(/[^A-Za-z0-9]+/g, '_')}`}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GameMetaToolbar({ gameId, bookmarked, notes, onFlip, onShare, linkCopied }: { gameId: number; bookmarked: boolean; notes: string; onFlip: () => void; onShare: () => void; linkCopied: boolean }) {
  const { t } = useTranslation();
  const [showNotes, setShowNotes] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => { setDraft(notes); }, [notes]);

  const star = useMutation({
    mutationFn: (next: boolean) => api.patch(`/api/games/${gameId}/bookmark`, { bookmarked: next }),
  });
  const [isStarred, setStarred] = useState(bookmarked);
  useEffect(() => { setStarred(bookmarked); }, [bookmarked]);

  const saveNotes = useMutation({
    mutationFn: (text: string) => api.patch(`/api/games/${gameId}/notes`, { notes: text }),
    onSuccess: () => { setSavedAt(Date.now()); setTimeout(() => setSavedAt(null), 1400); },
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <button
          onClick={() => { const next = !isStarred; setStarred(next); star.mutate(next); }}
          className={`btn-ghost px-2 py-1 text-xs ${isStarred ? 'text-gold-600 dark:text-gold-400' : ''}`}
          title={t('shortcuts.bookmark', { defaultValue: 'Toggle bookmark' })}
        >
          <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-gold-500' : ''}`} />
          {isStarred ? t('review.starred', { defaultValue: 'Starred' }) : t('review.star', { defaultValue: 'Star' })}
        </button>
        <button onClick={onFlip} className="btn-ghost px-2 py-1 text-xs" title={t('shortcuts.flipBoard', { defaultValue: 'Flip board' })}>
          <FlipVertical2 className="h-3.5 w-3.5" /> {t('review.flip', { defaultValue: 'Flip' })}
        </button>
        <button onClick={onShare} className="btn-ghost px-2 py-1 text-xs" title={t('shortcuts.share', { defaultValue: 'Copy link to position' })}>
          {linkCopied ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Share2 className="h-3.5 w-3.5" />}
          {linkCopied ? t('common.copied') : t('review.share', { defaultValue: 'Share position' })}
        </button>
        <button
          onClick={() => setShowNotes((s) => !s)}
          className={`btn-ghost ml-auto px-2 py-1 text-xs ${showNotes ? 'text-chesscom-900 dark:text-chesscom-100' : ''}`}
          title={t('review.notes', { defaultValue: 'Notes' })}
        >
          <NotebookPen className="h-3.5 w-3.5" />
          {t('review.notes', { defaultValue: 'Notes' })}
          {notes && !showNotes && <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-500" />}
        </button>
      </div>
      {showNotes && (
        <div className="border-t border-chesscom-200 p-2 dark:border-chesscom-700">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft !== notes) saveNotes.mutate(draft); }}
            placeholder={t('review.notesPlaceholder', { defaultValue: 'Your private notes on this game…' })}
            className="input min-h-[88px] w-full resize-y text-sm"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-chesscom-400">
            <span>{t('review.notesPrivate', { defaultValue: 'Only you can see this.' })}</span>
            <span>{savedAt ? t('common.saved', { defaultValue: 'Saved' }) : (draft !== notes ? t('review.notesUnsaved', { defaultValue: 'Click outside to save' }) : '')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerHeader({ name, accuracy, elo, side, fen, highlighted }: { name: string; accuracy?: number; elo?: number | null; side: 'white' | 'black'; fen: string; highlighted?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md px-3 py-2 shadow-soft transition-colors ${
        highlighted
          ? 'border-l-4 border-gold-500 bg-white dark:bg-chesscom-800 text-chesscom-900 dark:text-chesscom-100'
          : 'bg-white text-chesscom-900 dark:bg-chesscom-800/70 dark:text-chesscom-100'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${side === 'white' ? 'bg-white border border-chesscom-300' : 'bg-chesscom-900 border border-chesscom-700'}`} />
        <span className="truncate text-sm font-semibold">{name}</span>
        {elo != null && <span className="font-mono text-xs font-semibold tabular-nums text-chesscom-500">({elo})</span>}
      </div>
      <div className="flex items-center gap-3">
        <CapturedPieces fen={fen} side={side} />
        {accuracy != null && (
          <span className="font-mono text-sm font-bold tabular-nums">{accuracy.toFixed(1)}<span className="text-xs opacity-70">%</span></span>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative flex items-center gap-1 px-2 py-2 text-xs font-medium transition-colors sm:gap-1.5 sm:px-3 ${active ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-500 hover:text-chesscom-900 dark:hover:text-chesscom-100'}`}
    >
      <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
      <span className="hidden sm:inline">{label}</span>
      {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-gold-500 sm:inset-x-2" />}
    </button>
  );
}

function ExportRow({ pgn, fen, fileBase }: { pgn: string; fen: string; fileBase: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'fen' | 'pgn' | null>(null);

  async function copy(kind: 'fen' | 'pgn', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // Clipboard API may be denied; silently no-op.
    }
  }

  function downloadPgn() {
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${fileBase}.pgn`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card flex flex-wrap items-center gap-2 p-2 text-xs">
      <button onClick={() => copy('fen', fen)} className="btn-ghost px-2 py-1 text-xs" title={t('review.copyFenTitle')}>
        {copied === 'fen' ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === 'fen' ? t('common.copied') : `${t('common.copy')} FEN`}
      </button>
      <button onClick={() => copy('pgn', pgn)} className="btn-ghost px-2 py-1 text-xs" title={t('review.copyPgnTitle')}>
        {copied === 'pgn' ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === 'pgn' ? t('common.copied') : `${t('common.copy')} PGN`}
      </button>
      <button onClick={downloadPgn} className="btn-ghost px-2 py-1 text-xs" title={t('review.downloadPgnTitle')}>
        <Download className="h-3.5 w-3.5" />
        {t('common.download')}
      </button>
    </div>
  );
}

function LinesPanel({ enabled, onToggle, lines, loading, error, playedUci, onAdvance, onHover }: {
  enabled: boolean;
  onToggle: () => void;
  lines: EngineLine[];
  loading: boolean;
  error: boolean;
  playedUci: string | null;
  onAdvance: () => void;
  onHover: (l: EngineLine | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1 border-b border-chesscom-100 bg-chesscom-50/40 px-3 py-2 dark:border-chesscom-700 dark:bg-chesscom-900/40">
        <Search className="h-3.5 w-3.5 text-chesscom-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-chesscom-500 dark:text-chesscom-300">
          {t('review.lines', { defaultValue: 'Engine lines' })}
        </span>
        <button
          onClick={onToggle}
          className={`btn-ghost ml-auto px-2 py-1 text-xs ${enabled ? 'text-board-dark' : ''}`}
        >
          {enabled
            ? t('review.linesHide', { defaultValue: 'Hide' })
            : t('review.linesShow', { defaultValue: 'Show top engine lines' })}
        </button>
      </div>
      {enabled && (
        <div className="space-y-1 p-2">
          {loading && lines.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-chesscom-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('review.linesFetching', { defaultValue: 'fetching…' })}
            </div>
          )}
          {!loading && !error && lines.length === 0 && (
            <div className="px-2 py-3 text-xs text-chesscom-400">—</div>
          )}
          {error && (
            <div className="px-2 py-3 text-xs text-chesscom-400">—</div>
          )}
          {lines.map((l) => {
            const isPlayed = playedUci != null && playedUci.length >= 4 && l.uci.slice(0, 4) === playedUci.slice(0, 4);
            const pv = l.pv_san.slice(0, 6).join(' ');
            return (
              <button
                key={l.multipv}
                onClick={() => { if (isPlayed) onAdvance(); }}
                onMouseEnter={() => onHover(l)}
                onMouseLeave={() => onHover(null)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  isPlayed
                    ? 'cursor-pointer bg-board-dark/10 hover:bg-board-dark/15'
                    : 'cursor-default hover:bg-chesscom-50 dark:hover:bg-chesscom-900/40'
                }`}
              >
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  l.multipv === 1 ? 'bg-gold-500/20 text-gold-600' : 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-800'
                }`}>{l.multipv}</span>
                <span className="w-12 shrink-0 font-mono text-xs font-semibold tabular-nums">
                  {l.mate != null ? (l.mate > 0 ? `#${l.mate}` : `-#${Math.abs(l.mate)}`) : fmtCp(l.cp)}
                </span>
                <span className="w-12 shrink-0 truncate font-mono font-semibold text-chesscom-900 dark:text-chesscom-100">{l.san}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-chesscom-500">{pv}</span>
                {isPlayed && <span className="shrink-0 text-[10px] uppercase text-board-dark">{t('review.linesPlayed', { defaultValue: 'played' })}</span>}
              </button>
            );
          })}
          {loading && lines.length > 0 && (
            <div className="flex items-center gap-2 px-2 pt-1 text-[11px] text-chesscom-400">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('review.linesRefreshing', { defaultValue: 'refreshing…' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalyzerSkeleton() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse">
      <div className="mb-4 h-7 w-40 rounded bg-chesscom-200/70 dark:bg-chesscom-700/70" />
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <div className="lg:flex-1 lg:max-w-[760px]">
          <div className="aspect-square w-full rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
          <div className="mt-3 h-12 rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
        </div>
        <div className="space-y-3 lg:w-[380px]">
          <div className="h-24 rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
          <div className="h-32 rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
          <div className="h-48 rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
        </div>
      </div>
    </div>
  );
}
