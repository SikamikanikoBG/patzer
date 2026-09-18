import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import { Crosshair, Loader2 } from 'lucide-react';
import { api } from '../api';

// "What's the threat?" — for the current position, what would the side that
// just moved play next if the side to move simply passed? We build the
// null-move FEN (flip the turn, drop the en-passant square) and ask the ad-hoc
// engine endpoint for its single best line. No LLM involved: the sentence is
// assembled from the move's own facts (capture / check / mate) and the eval
// swing, so it can never invent a continuation.

interface EngineLine {
  uci: string;
  san: string;
  pv_san: string[];
  cp: number | null;
  mate: number | null;
  multipv: number;
}

export interface Threat {
  san: string;
  pv: string[];
  /** Material the threatened move captures, if any (chess.js piece letter). */
  captured: string | null;
  to: string;
  isCheck: boolean;
  isMate: boolean;
  /** Mate-in-N for the threatening side, if the engine sees one. */
  mateIn: number | null;
  /** How much the side to move loses (cp, its own perspective) by passing. */
  swingCp: number;
}

/** Flip the side to move. Returns null when the side to move is in check —
 *  passing is not a legal notion there and Stockfish would see an illegal
 *  position (a king en prise on the other side's turn). */
export function nullMoveFen(fen: string): string | null {
  let chess: Chess;
  try { chess = new Chess(fen); } catch { return null; }
  if (chess.isCheck() || chess.isGameOver()) return null;
  const parts = fen.split(' ');
  if (parts.length < 4) return null;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}

/** Turn an engine line from the null-move position into a Threat. `currentCpStm`
 *  is the eval of the real position from the side-to-move's perspective. */
export function threatFromLine(nullFen: string, line: EngineLine, currentCpStm: number): Threat | null {
  let chess: Chess;
  try { chess = new Chess(nullFen); } catch { return null; }
  let mv: ReturnType<Chess['move']>;
  try {
    mv = chess.move({ from: line.uci.slice(0, 2), to: line.uci.slice(2, 4), promotion: line.uci.slice(4) || undefined });
  } catch {
    return null;
  }
  // Engine cp is from the threatening side's view. If we sit at +50 and after
  // passing they sit at +150, ignoring the threat costs us 200.
  const theirCp = line.mate != null ? (line.mate > 0 ? 10000 : -10000) : (line.cp ?? 0);
  const swingCp = Math.max(0, currentCpStm + theirCp);
  return {
    san: mv.san,
    pv: line.pv_san.slice(0, 5),
    captured: mv.captured ?? null,
    to: mv.to,
    isCheck: chess.isCheck(),
    isMate: chess.isCheckmate(),
    mateIn: line.mate != null && line.mate > 0 ? line.mate : null,
    swingCp,
  };
}

const PIECE_KEY: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export default function ThreatPanel({ fen, currentCpWhite }: { fen: string; currentCpWhite: number }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [threat, setThreat] = useState<Threat | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'check' | 'ok'>('idle');

  const nullFen = fen ? nullMoveFen(fen) : null;
  const stm = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const currentCpStm = stm === 'white' ? currentCpWhite : -currentCpWhite;

  useEffect(() => {
    if (!enabled || !fen) return;
    if (!nullFen) { setThreat(null); setState('check'); return; }
    let cancelled = false;
    setState('loading');
    // The endpoint is single-flight per user: if the engine-lines panel is
    // mid-search we get a 429, so back off and retry a few times.
    const attempt = (n: number) => {
      api.post<{ lines: EngineLine[] }>('/api/analyze/position', { fen: nullFen, depth: 14, lines: 1 })
        .then((r) => {
          if (cancelled) return;
          const line = r.lines?.[0];
          const th = line ? threatFromLine(nullFen, line, currentCpStm) : null;
          setThreat(th);
          setState(th ? 'ok' : 'error');
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const status = (err as { status?: number } | null)?.status;
          if (status === 429 && n < 4) { window.setTimeout(() => { if (!cancelled) attempt(n + 1); }, 900); return; }
          setThreat(null);
          setState('error');
        });
    };
    const handle = window.setTimeout(() => attempt(0), 400);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [enabled, fen, nullFen, currentCpStm]);

  function describe(th: Threat): string {
    const piece = th.captured ? t(`threat.pieces.${PIECE_KEY[th.captured] ?? 'pawn'}`, { defaultValue: PIECE_KEY[th.captured] ?? 'piece' }) : null;
    if (th.isMate || th.mateIn === 1) return t('threat.mate', { defaultValue: 'checkmate' });
    if (th.mateIn != null) return t('threat.mateIn', { n: th.mateIn, defaultValue: 'mate in {{n}}' });
    const parts: string[] = [];
    if (piece) parts.push(t('threat.takes', { piece, square: th.to, defaultValue: 'takes the {{piece}} on {{square}}' }));
    else if (th.isCheck) parts.push(t('threat.check', { defaultValue: 'gives check' }));
    if (th.swingCp >= 800) parts.push(t('threat.winsDecisive', { defaultValue: 'winning decisive material' }));
    else if (th.swingCp >= 450) parts.push(t('threat.winsRook', { defaultValue: 'winning a rook or more' }));
    else if (th.swingCp >= 250) parts.push(t('threat.winsPiece', { defaultValue: 'winning a piece' }));
    else if (th.swingCp >= 150) parts.push(t('threat.winsExchange', { defaultValue: 'winning the exchange' }));
    else if (th.swingCp >= 70) parts.push(t('threat.winsPawn', { defaultValue: 'winning a pawn' }));
    else if (parts.length === 0) return t('threat.none', { defaultValue: 'no immediate material threat — a quiet improving move' });
    else parts.push(t('threat.small', { defaultValue: 'a small gain' }));
    return parts.join(', ');
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1 border-b border-chesscom-100 bg-chesscom-50/40 px-3 py-2 dark:border-chesscom-700 dark:bg-chesscom-900/40">
        <Crosshair className="h-3.5 w-3.5 text-chesscom-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
          {t('threat.title', { defaultValue: "What's the threat?" })}
        </span>
        <button
          onClick={() => setEnabled((s) => !s)}
          className={`btn-ghost ml-auto px-2 py-1 text-xs ${enabled ? 'text-board-dark' : ''}`}
        >
          {enabled ? t('review.linesHide', { defaultValue: 'Hide' }) : t('threat.show', { defaultValue: 'Show threat' })}
        </button>
      </div>
      {enabled && (
        <div className="px-3 py-2 text-xs">
          {state === 'loading' && (
            <div className="flex items-center gap-2 py-1 text-chesscom-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('review.linesFetching', { defaultValue: 'fetching…' })}
            </div>
          )}
          {state === 'check' && (
            <div className="py-1 text-chesscom-500">{t('threat.inCheck', { defaultValue: 'In check — the threat is the check itself.' })}</div>
          )}
          {state === 'error' && <div className="py-1 text-chesscom-400">—</div>}
          {state === 'ok' && threat && (
            <div className="space-y-1 py-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] uppercase tracking-wider text-chesscom-500">
                  {t('threat.if', { side: t(`threat.side.${stm}`, { defaultValue: stm }), defaultValue: 'If {{side}} passed' })}
                </span>
                <span className="font-mono text-sm font-bold text-chesscom-900 dark:text-chesscom-100">{threat.san}</span>
              </div>
              <div className="text-chesscom-700 dark:text-chesscom-300">{describe(threat)}</div>
              {threat.pv.length > 1 && (
                <div className="truncate font-mono text-[11px] text-chesscom-500">{threat.pv.join(' ')}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
