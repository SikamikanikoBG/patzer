// Lab — a position sandbox with on-demand Stockfish analysis. Drop a FEN,
// shuffle pieces, click Analyze, browse top-N candidate lines. Designed for
// the "what does the engine think about this?" moment after a game.

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Chess } from 'chess.js';
import {
  Microscope, RotateCcw, FlipVertical2, Wand2, Loader2,
} from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';

interface AnalyzeLine {
  uci: string;
  san: string;
  pv_san: string[];
  cp: number | null;
  mate: number | null;
  multipv: number;
}

interface AnalyzeResponse {
  fen: string;
  depth: number;
  lines: AnalyzeLine[];
}

interface HistoryEntry {
  fen: string;       // FEN AFTER this move
  san: string;       // the move played to reach this fen
}

export default function Lab() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Authoritative game state lives in a ref to avoid stale closures.
  const chessRef = useRef<Chess>(new Chess());
  // Counter forces re-renders / ChessBoard re-sync since chess.js mutates.
  const [tick, setTick] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0); // 0 = start; N = after Nth move

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  const [depth, setDepth] = useState(16);
  const [lines, setLines] = useState(3);

  const fen = chessRef.current.fen();
  const turn = chessRef.current.turn() === 'w' ? 'white' : 'black';

  const analyze = useMutation({
    mutationFn: () => api.post<AnalyzeResponse>('/api/analyze/position', { fen, depth, lines }),
  });

  function bump() { setTick((k) => k + 1); }

  function onMove(uci: string) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length === 5 ? uci[4] : undefined;
    try {
      const move = chessRef.current.move({ from, to, promotion } as never);
      if (!move) return;
      // If we're not at the tip, truncate forward history first.
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex);
        return [...trimmed, { fen: chessRef.current.fen(), san: move.san }];
      });
      setHistoryIndex((i) => i + 1);
      bump();
    } catch {
      // illegal — chessground will reject via legalDests; ignore
      bump();
    }
  }

  function resetBoard() {
    chessRef.current = new Chess();
    setHistory([]);
    setHistoryIndex(0);
    analyze.reset();
    bump();
  }

  function flip() {
    setOrientation((o) => (o === 'white' ? 'black' : 'white'));
  }

  function setFromFen() {
    const trimmed = fenInput.trim();
    if (!trimmed) return;
    try {
      const test = new Chess(trimmed);
      chessRef.current = test;
      setHistory([]);
      setHistoryIndex(0);
      analyze.reset();
      setFenError(null);
      bump();
    } catch (e) {
      setFenError(e instanceof Error ? e.message : t('lab.invalidFen', { defaultValue: 'Invalid FEN' }));
    }
  }

  function gotoPly(index: number) {
    // Reconstruct chess at the given history position by replaying.
    const replay = new Chess();
    for (let i = 0; i < index; i++) {
      const entry = history[i];
      if (!entry) break;
      // Use the FEN directly for simplicity & correctness with promotions.
      replay.load(entry.fen);
    }
    chessRef.current = replay;
    setHistoryIndex(index);
    analyze.reset();
    bump();
  }

  function playLineMove(uci: string) {
    onMove(uci);
  }

  const result = analyze.data;
  const arrows = useMemo(() => {
    if (!result || result.lines.length === 0) return [];
    const best = result.lines[0];
    if (!best) return [];
    return [{ orig: best.uci.slice(0, 2), dest: best.uci.slice(2, 4), brush: 'paleBlue' as const }];
  }, [result]);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1 flex items-center gap-2">
            <Microscope className="h-6 w-6 text-board-dark" />
            {t('lab.title', { defaultValue: 'Lab' })}
          </h1>
          <p className="page-sub">
            {t('lab.subtitle', { defaultValue: 'A sandbox board with Stockfish on tap.' })}
          </p>
        </div>
        <div className="text-xs text-chesscom-500">
          {turn === 'white'
            ? t('lab.whiteToMove', { defaultValue: 'White to move' })
            : t('lab.blackToMove', { defaultValue: 'Black to move' })}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Board pane */}
        <section className="space-y-3">
          <div className={`mx-auto w-full max-w-[640px] board-theme-${user?.profile.board_theme ?? 'green'}`}>
            <ChessBoard
              key={tick === 0 ? 'init' : 'live'}
              fen={fen}
              orientation={orientation}
              turnColor={turn}
              movable
              onMove={onMove}
              arrows={arrows as never}
              resetKey={tick}
            />
          </div>

          <div className="card space-y-2 p-3">
            <div className="flex items-center gap-2">
              <input
                value={fenInput}
                onChange={(e) => setFenInput(e.target.value)}
                placeholder={t('lab.fenPlaceholder', { defaultValue: 'Paste a FEN…' })}
                className="input flex-1 font-mono text-xs"
                spellCheck={false}
              />
              <button onClick={setFromFen} className="btn-secondary text-sm">
                {t('lab.setFen', { defaultValue: 'Set' })}
              </button>
            </div>
            {fenError && <div className="text-xs text-mistake">{fenError}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={resetBoard} className="btn-ghost text-sm">
                <RotateCcw className="h-4 w-4" />
                {t('lab.reset', { defaultValue: 'Reset' })}
              </button>
              <button onClick={flip} className="btn-ghost text-sm">
                <FlipVertical2 className="h-4 w-4" />
                {t('lab.flip', { defaultValue: 'Flip board' })}
              </button>
              <div className="ml-auto font-mono text-[11px] tabular-nums text-chesscom-400">
                {fen}
              </div>
            </div>
          </div>
        </section>

        {/* Analysis pane */}
        <aside className="space-y-3">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
                {t('lab.engine', { defaultValue: 'Engine analysis' })}
              </h2>
              <button
                onClick={() => analyze.mutate()}
                disabled={analyze.isPending}
                className="btn-primary text-sm"
              >
                {analyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {analyze.isPending
                  ? t('lab.analyzing', { defaultValue: 'Analyzing…' })
                  : t('lab.analyze', { defaultValue: 'Analyze' })}
              </button>
            </div>

            <div className="space-y-3">
              <Slider
                label={t('lab.depth', { defaultValue: 'Depth' })}
                value={depth}
                min={8}
                max={22}
                onChange={setDepth}
              />
              <Slider
                label={t('lab.lines', { defaultValue: 'Lines' })}
                value={lines}
                min={1}
                max={5}
                onChange={setLines}
              />
            </div>
          </div>

          {analyze.isPending ? (
            <div className="card flex items-center gap-2 p-4 text-sm text-chesscom-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('lab.crunching', { defaultValue: 'Crunching positions…' })}
            </div>
          ) : result && result.lines.length > 0 ? (
            <div className="card divide-y divide-chesscom-100 dark:divide-chesscom-700">
              {result.lines.map((line, i) => (
                <LineRow key={i} line={line} rank={i + 1} onPlay={playLineMove} />
              ))}
              <div className="px-3 py-1.5 text-right text-[11px] text-chesscom-400">
                {t('lab.depthLabel', { defaultValue: 'depth' })} {result.depth}
              </div>
            </div>
          ) : analyze.isError ? (
            <div className="card p-4 text-sm text-mistake">
              {t('lab.analyzeError', { defaultValue: 'Analysis failed. Is Stockfish configured?' })}
            </div>
          ) : (
            <div className="card p-4 text-center text-sm text-chesscom-500">
              {t('lab.idlePrompt', { defaultValue: 'Click Analyze to see what Stockfish thinks.' })}
            </div>
          )}

          {history.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-chesscom-200 px-3 py-2 dark:border-chesscom-700">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
                  {t('lab.moves', { defaultValue: 'Moves' })}
                </h2>
                <span className="text-[11px] text-chesscom-400">{history.length}</span>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                <button
                  onClick={() => gotoPly(0)}
                  className={`w-full rounded px-2 py-1 text-left text-xs font-mono tabular-nums ${
                    historyIndex === 0
                      ? 'bg-gold-500/15 text-chesscom-900 dark:text-chesscom-100'
                      : 'text-chesscom-500 hover:bg-chesscom-100/60 dark:hover:bg-chesscom-700/40'
                  }`}
                >
                  {t('lab.startPos', { defaultValue: 'Start' })}
                </button>
                {history.map((h, i) => {
                  const ply = i + 1;
                  const moveNum = Math.ceil(ply / 2);
                  const label = ply % 2 === 1 ? `${moveNum}. ${h.san}` : `${moveNum}… ${h.san}`;
                  const isActive = historyIndex === ply;
                  return (
                    <button
                      key={i}
                      onClick={() => gotoPly(ply)}
                      className={`w-full rounded px-2 py-1 text-left text-xs font-mono tabular-nums ${
                        isActive
                          ? 'bg-gold-500/15 text-chesscom-900 dark:text-chesscom-100'
                          : 'text-chesscom-600 hover:bg-chesscom-100/60 dark:text-chesscom-200 dark:hover:bg-chesscom-700/40'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function LineRow({ line, rank, onPlay }: { line: AnalyzeLine; rank: number; onPlay: (uci: string) => void }) {
  const evalLabel = formatEval(line.cp, line.mate);
  const evalTone =
    line.mate != null
      ? line.mate > 0
        ? 'text-board-dark'
        : 'text-mistake'
      : (line.cp ?? 0) >= 30
      ? 'text-board-dark'
      : (line.cp ?? 0) <= -30
      ? 'text-mistake'
      : 'text-chesscom-700 dark:text-chesscom-200';

  const tail = line.pv_san.slice(1);

  return (
    <div className="flex items-start gap-2 px-3 py-2 text-xs">
      <span className="mt-0.5 font-mono text-[11px] tabular-nums text-chesscom-400">{rank}.</span>
      <span className={`mt-0.5 w-12 shrink-0 font-mono text-xs tabular-nums ${evalTone}`}>
        {evalLabel}
      </span>
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onPlay(line.uci)}
          className="rounded bg-chesscom-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-chesscom-900 hover:bg-gold-500/20 dark:bg-chesscom-700 dark:text-chesscom-100"
          title={line.uci}
        >
          {line.san}
        </button>
        {tail.length > 0 && (
          <span className="ml-2 font-mono text-xs tabular-nums text-chesscom-500">
            {tail.join(' ')}
          </span>
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-chesscom-500">{label}</span>
        <span className="font-mono tabular-nums text-chesscom-700 dark:text-chesscom-200">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-board-dark"
      />
    </div>
  );
}

function formatEval(cp: number | null, mate: number | null): string {
  if (mate != null) return mate > 0 ? `#${mate}` : `#${mate}`;
  if (cp == null) return '—';
  const pawns = cp / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '' : '';
  return `${sign}${pawns.toFixed(2)}`;
}
