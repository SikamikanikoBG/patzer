import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Sparkles, Settings as SettingsIcon, Copy, Download, Check, ListOrdered, Lightbulb, FileText, Star, Share2, FlipVertical2, NotebookPen } from 'lucide-react';
import { Chess } from 'chess.js';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import CoachPanel from '../components/CoachPanel';
import GameReportCard from '../components/GameReportCard';
import GameReportPanel, { type GameReviewProse } from '../components/GameReportPanel';
import KeyMomentsList from '../components/KeyMomentsList';
import OpeningBanner from '../components/OpeningBanner';
import ClassificationBadge from '../components/ClassificationBadge';
import CapturedPieces from '../components/CapturedPieces';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import { api } from '../api';
import { useAuth } from '../state/auth';
import type { AnalysisResult, AnalyzedMove, KeyMomentSummary, PhaseSplit } from '../types';

interface GameDetail {
  game: { id: number; pgn: string; white: string; black: string; result: string; user_color: 'white' | 'black' | null; eco?: string | null; opening_name?: string | null; bookmarked?: number | null; notes?: string | null };
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

function fmtCp(cp: number | null | undefined): string {
  if (cp == null) return '0.00';
  if (cp >= 9000) return '#';
  if (cp <= -9000) return '-#';
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

type Tab = 'review' | 'report' | 'moments' | 'coach';

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
  const [tab, setTab] = useState<Tab>('review');
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
    const replay = new Chess();
    const list: { fen: string; san?: string; from?: string; to?: string }[] = [{ fen: replay.fen() }];
    for (const m of history) {
      replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      list.push({ fen: replay.fen(), san: m.san, from: m.from, to: m.to });
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

  if (isLoading || !data) return <AnalyzerSkeleton />;

  const pos = positions[ply] ?? positions[0];
  const move: AnalyzedMove | undefined = analysis?.moves[ply - 1];
  const userColor = data.game.user_color ?? 'white';
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
      pv_san: move.best_pv,
      history: historySoFar,
    },
  }) : null;

  const arrow = move?.best_move_uci && move.best_move_uci !== move.uci ? [{
    orig: move.best_move_uci.slice(0, 2) as never,
    dest: move.best_move_uci.slice(2, 4) as never,
    brush: 'paleBlue',
  }] : [];

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
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
        {/* BOARD COLUMN */}
        <div className="mx-auto w-full lg:mx-0 lg:flex-1 lg:max-w-[760px]">
          <PlayerHeader
            name={orientation === 'white' ? data.game.black : data.game.white}
            accuracy={orientation === 'white' ? analysis?.accuracy_black : analysis?.accuracy_white}
            elo={orientation === 'white' ? analysis?.estimated_elo_black : analysis?.estimated_elo_white}
            side={orientation === 'white' ? 'black' : 'white'}
            fen={pos?.fen ?? ''}
          />
          <div className="relative my-2 flex items-stretch gap-2">
            <EvalBar cp={currentEvalCp} orientation={orientation} />
            <div className={`relative min-w-0 flex-1 board-theme-${user?.profile.board_theme ?? 'green'}`}>
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
                  <span className="font-medium text-chesscom-900 dark:text-chesscom-100">{ply % 2 === 1 ? 'W' : 'B'}: {move.san}</span>
                  {move.best_move_san && move.best_move_san !== move.san && (
                    <span className="ml-2 text-xs text-chesscom-400">best: {move.best_move_san}</span>
                  )}
                </>
              ) : <span className="italic">starting position</span>}
            </div>
            <div className="font-mono text-base font-semibold tabular-nums">
              {fmtCp(currentEvalCp)}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button onClick={() => setPly(0)} className="btn-secondary h-12 w-12 p-0" title="First"><ChevronsLeft className="h-5 w-5" /></button>
            <button onClick={() => setPly((p) => Math.max(0, p - 1))} className="btn-secondary h-12 w-12 p-0" title="Previous"><ChevronLeft className="h-5 w-5" /></button>
            <div className="flex h-12 min-w-[5.5rem] items-center justify-center rounded-xl bg-chesscom-100 px-3 text-sm font-mono tabular-nums dark:bg-chesscom-800">
              {ply} / {positions.length - 1}
            </div>
            <button onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))} className="btn-secondary h-12 w-12 p-0" title="Next"><ChevronRight className="h-5 w-5" /></button>
            <button onClick={() => setPly(positions.length - 1)} className="btn-secondary h-12 w-12 p-0" title="Last"><ChevronsRight className="h-5 w-5" /></button>
          </div>

          {analysis && (
            <div className="mt-3 card p-2">
              <EvalGraph
                evals={analysis.moves.map((m) => ({ ply: m.ply, cp: m.eval_after_cp }))}
                current={ply}
                onClick={(p) => setPly(p)}
                markers={analysis.moves
                  .filter((m) => ['blunder','mistake','inaccuracy','miss','brilliant','great'].includes(m.classification))
                  .map((m) => ({ ply: m.ply, classification: m.classification }))}
              />
            </div>
          )}
        </div>

        {/* RIGHT RAIL */}
        <div className="min-w-0 space-y-3 lg:w-[380px] lg:flex-initial lg:max-w-md">
          {!analysis && (
            <button onClick={() => analyze(requestedDepth, false)} disabled={analyzing} className="btn-primary w-full">
              <Sparkles className="h-4 w-4" />
              {analyzing ? t('review.analyzing', { progress: '…' }) : t('review.analyze')}
            </button>
          )}

          {analysis && (
            <>
              <OpeningBanner eco={eco} name={openingName} prose={reviewProse?.opening?.prose} />

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
                  <div className="mt-1 flex justify-between text-[10px] text-chesscom-400">
                    <span>fast (8)</span>
                    <span>quality (16)</span>
                    <span>deep (22)</span>
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

              {/* Tab strip — Review (move list), Report (AI prose), Moments, Coach */}
              <div className="card overflow-hidden">
                <div className="flex items-center gap-1 border-b border-chesscom-100 bg-chesscom-50/40 px-2 dark:border-chesscom-700 dark:bg-chesscom-900/40">
                  <TabBtn active={tab === 'review'} onClick={() => setTab('review')} icon={ListOrdered} label={t('review.moves')} />
                  <TabBtn active={tab === 'report'} onClick={() => setTab('report')} icon={FileText} label={t('review.gameReport', { defaultValue: 'Report' })} />
                  <TabBtn active={tab === 'moments'} onClick={() => setTab('moments')} icon={Sparkles} label={t('review.keyMoments', { defaultValue: 'Key' })} />
                  <TabBtn active={tab === 'coach'} onClick={() => setTab('coach')} icon={Lightbulb} label={t('coach.title')} />
                  <button onClick={() => setShowDepthControl((s) => !s)} className="btn-ghost ml-auto p-1.5" title={t('review.depth')}>
                    <SettingsIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-3">
                  {tab === 'review' && (
                    <MoveList
                      moves={analysis.moves.map((m) => ({ ply: m.ply, san: m.san, classification: m.classification }))}
                      current={ply}
                      onSelect={setPly}
                      phaseSplit={analysis.phase_split}
                      maxHeight={460}
                    />
                  )}
                  {tab === 'report' && (
                    <GameReportPanel
                      gameId={gameId}
                      initial={reviewProse}
                      onMomentJump={setPly}
                      onGenerated={setReviewProse}
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
                        };
                      })}
                      current={ply}
                      onSelect={setPly}
                    />
                  )}
                  {tab === 'coach' && coachReq && (
                    <CoachPanel
                      systemConfigured={coachConfigured}
                      request={coachReq}
                      autoPlay
                      triggerKey={ply}
                      debounceMs={700}
                      compact
                    />
                  )}
                  {tab === 'coach' && !coachReq && (
                    <div className="p-4 text-sm text-chesscom-500">{t('review.coachIdleHint', { defaultValue: 'Step into a move to see what the coach has to say.' })}</div>
                  )}
                </div>
              </div>

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
          <div className="mt-1 flex items-center justify-between text-[10px] text-chesscom-400">
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
    <button onClick={onClick} className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${active ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-500 hover:text-chesscom-900 dark:hover:text-chesscom-100'}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold-500" />}
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
      <button onClick={() => copy('fen', fen)} className="btn-ghost px-2 py-1 text-xs" title="Copy FEN of current position">
        {copied === 'fen' ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === 'fen' ? t('common.copied') : `${t('common.copy')} FEN`}
      </button>
      <button onClick={() => copy('pgn', pgn)} className="btn-ghost px-2 py-1 text-xs" title="Copy full PGN">
        {copied === 'pgn' ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === 'pgn' ? t('common.copied') : `${t('common.copy')} PGN`}
      </button>
      <button onClick={downloadPgn} className="btn-ghost px-2 py-1 text-xs" title="Download .pgn">
        <Download className="h-3.5 w-3.5" />
        {t('common.download')}
      </button>
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
