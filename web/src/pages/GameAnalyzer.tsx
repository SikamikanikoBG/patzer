import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Sparkles, Trophy, Settings as SettingsIcon } from 'lucide-react';
import { Chess } from 'chess.js';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import CoachPanel from '../components/CoachPanel';
import ClassificationStats from '../components/ClassificationStats';
import ClassificationBadge from '../components/ClassificationBadge';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import { api } from '../api';
import { fmtAccuracy } from '../lib/utils';
import { useAuth } from '../state/auth';
import type { AnalysisResult, AnalyzedMove, Classification } from '../types';

interface GameDetail {
  game: { id: number; pgn: string; white: string; black: string; result: string; user_color: 'white' | 'black' | null };
  analysis: {
    depth: number; accuracy_white: number; accuracy_black: number;
    estimated_elo_white: number | null; estimated_elo_black: number | null;
    moves_json: string;
  } | null;
}

function fmtCp(cp: number | null | undefined): string {
  if (cp == null) return '0.00';
  if (cp >= 9000) return '#';
  if (cp <= -9000) return '-#';
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

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

  useEffect(() => {
    if (!data) return;
    if (data.analysis) {
      setAnalysis({
        depth: data.analysis.depth,
        accuracy_white: data.analysis.accuracy_white,
        accuracy_black: data.analysis.accuracy_black,
        estimated_elo_white: data.analysis.estimated_elo_white,
        estimated_elo_black: data.analysis.estimated_elo_black,
        moves: JSON.parse(data.analysis.moves_json),
      });
      setRequestedDepth(Math.max(16, data.analysis.depth));
    } else {
      setAnalysis(null);
    }
  }, [data]);

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

  const [ply, setPly] = useState(0);

  useEffect(() => { setPly(0); }, [gameId]);

  // Play move sounds as the user steps through the game
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

  function jumpToFirstClassification(cls: Classification, side: 'white' | 'black') {
    if (!analysis) return;
    const wantParity = side === 'white' ? 1 : 0;
    for (const m of analysis.moves) {
      if (m.classification === cls && (m.ply % 2 === wantParity)) { setPly(m.ply); return; }
    }
  }

  if (isLoading || !data) return <div className="p-6 text-ink-500">{t('common.loading')}</div>;

  const pos = positions[ply] ?? positions[0];
  const move: AnalyzedMove | undefined = analysis?.moves[ply - 1];
  const userColor = data.game.user_color ?? 'white';
  const orientation = userColor;
  const currentEvalCp = move?.eval_after_cp ?? 0;

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
    },
  }) : null;

  const arrow = move?.best_move_uci && move.best_move_uci !== move.uci ? [{
    orig: move.best_move_uci.slice(0, 2) as never,
    dest: move.best_move_uci.slice(2, 4) as never,
    brush: 'paleBlue',
  }] : [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link to="/review" className="btn-ghost text-sm shrink-0"><ChevronLeft className="h-4 w-4" />{t('common.back')}</Link>
        <div className="min-w-0 truncate text-right text-sm text-ink-500">
          <span className="font-medium text-ink-700 dark:text-ink-200">{data.game.white}</span> vs{' '}
          <span className="font-medium text-ink-700 dark:text-ink-200">{data.game.black}</span>
          <span className="ml-2">· {data.game.result}</span>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <div className="mx-auto w-full lg:mx-0 lg:flex-1 lg:max-w-[760px]">
          <div className="relative flex items-stretch gap-2">
            <EvalBar cp={currentEvalCp} orientation={orientation} />
            <div className={`relative min-w-0 flex-1 board-theme-${user?.profile.board_theme ?? 'wood'}`}>
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
          <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-soft dark:bg-ink-800">
            <div className="min-w-0 truncate text-ink-500">
              {move ? (
                <>
                  <span className="font-medium text-ink-900 dark:text-cream">{ply % 2 === 1 ? 'W' : 'B'}: {move.san}</span>
                  {move.best_move_san && move.best_move_san !== move.san && (
                    <span className="ml-2 text-xs text-ink-400">best: {move.best_move_san}</span>
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
            <div className="flex h-12 min-w-[5.5rem] items-center justify-center rounded-xl bg-ink-100 px-3 text-sm font-mono tabular-nums dark:bg-ink-800">
              {ply} / {positions.length - 1}
            </div>
            <button onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))} className="btn-secondary h-12 w-12 p-0" title="Next"><ChevronRight className="h-5 w-5" /></button>
            <button onClick={() => setPly(positions.length - 1)} className="btn-secondary h-12 w-12 p-0" title="Last"><ChevronsRight className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="min-w-0 space-y-3 lg:w-[360px] lg:flex-initial lg:max-w-md">
          {!analysis && (
            <button onClick={() => analyze(requestedDepth, false)} disabled={analyzing} className="btn-primary w-full">
              <Sparkles className="h-4 w-4" />
              {analyzing ? t('review.analyzing', { progress: '…' }) : t('review.analyze')}
            </button>
          )}

          {analysis && (
            <>
              <SummaryCard
                accuracyW={analysis.accuracy_white}
                accuracyB={analysis.accuracy_black}
                eloW={analysis.estimated_elo_white}
                eloB={analysis.estimated_elo_black}
                depth={analysis.depth}
                whiteName={data.game.white}
                blackName={data.game.black}
                onToggleDepth={() => setShowDepthControl((s) => !s)}
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
                  <div className="mt-1 flex justify-between text-[10px] text-ink-400">
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
                  <div className="mt-2 text-[11px] text-ink-400">
                    Higher depth = more accurate, slower. Re-analyzing replaces the existing analysis.
                  </div>
                </div>
              )}

              {coachReq && (
                <CoachPanel
                  systemConfigured={coachConfigured}
                  request={coachReq}
                  autoPlay
                  triggerKey={ply}
                  debounceMs={700}
                />
              )}

              <ClassificationStats
                moves={analysis.moves}
                whiteName={data.game.white}
                blackName={data.game.black}
                onClickClassification={jumpToFirstClassification}
              />

              <div className="card p-2">
                <EvalGraph
                  evals={analysis.moves.map((m) => ({ ply: m.ply, cp: m.eval_after_cp }))}
                  current={ply}
                  onClick={(p) => setPly(p)}
                />
              </div>

              <MoveList
                moves={analysis.moves.map((m) => ({ ply: m.ply, san: m.san, classification: m.classification }))}
                current={ply}
                onSelect={setPly}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  accuracyW, accuracyB, eloW, eloB, depth, whiteName, blackName, onToggleDepth,
}: {
  accuracyW: number; accuracyB: number;
  eloW: number | null; eloB: number | null;
  depth: number; whiteName: string; blackName: string;
  onToggleDepth: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('review.summary')}</h3>
      <div className="grid grid-cols-2 gap-2">
        <PlayerCell label={t('review.white')} name={whiteName} accuracy={accuracyW} elo={eloW} side="white" />
        <PlayerCell label={t('review.black')} name={blackName} accuracy={accuracyB} elo={eloB} side="black" />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
        <span>{t('review.depth')}: {depth} · Elo is an estimate from this game</span>
        <button onClick={onToggleDepth} className="btn-ghost px-2 py-0.5 text-[10px] uppercase tracking-wide">
          <SettingsIcon className="h-3 w-3" /> depth
        </button>
      </div>
    </div>
  );
}

function PlayerCell({ label, name, accuracy, elo, side }: { label: string; name: string; accuracy: number; elo: number | null; side: 'white' | 'black' }) {
  const dot = side === 'white' ? 'bg-cream border border-ink-300' : 'bg-ink-900';
  return (
    <div className="rounded-lg bg-ink-100 px-3 py-2 dark:bg-ink-800">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${dot}`} />
        <span className="text-xs text-ink-500">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium">{name}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-400">Accuracy</div>
          <div className="font-mono text-base font-semibold tabular-nums">{fmtAccuracy(accuracy)}</div>
        </div>
        {elo != null && (
          <div>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-ink-400">
              <Trophy className="h-3 w-3" /> Est. Elo
            </div>
            <div className="font-mono text-base font-semibold tabular-nums">{elo}</div>
          </div>
        )}
      </div>
    </div>
  );
}
