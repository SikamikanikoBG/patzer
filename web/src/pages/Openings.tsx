// Openings — explore your repertoire as a clickable, collapsible tree.
// Each node is a (san, position) pair; child counts are pruned to top 8 by
// frequency on the server. Selecting a node renders its FEN on the mini-board
// and shows the W/D/L breakdown for that line.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, ChevronRight, ChevronDown, Compass, Target } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';

interface TreeNode {
  san: string;
  ply: number;
  fen: string;
  eco: string | null;
  opening_name: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  avg_accuracy: number | null;
  children: TreeNode[];
}

interface TreeResponse { total_games: number; root: TreeNode }

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export default function Openings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['openings-tree'],
    queryFn: () => api.get<TreeResponse>('/api/openings/tree'),
  });

  // Build a path key for each node so we can address it without referencing the object directly.
  // Path "" means root. Otherwise it's the joined SANs from root.
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));

  const root = data?.root ?? null;
  const selectedNode = useMemo(() => {
    if (!root) return null;
    return findNodeByPath(root, selectedPath);
  }, [root, selectedPath]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function onClickNode(node: TreeNode, path: string) {
    setSelectedPath(path);
    // Toggle expansion for non-leaves
    if (node.children.length > 0) {
      // Make sure clicking auto-expands (don't just toggle if currently closed)
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    }
  }

  if (isLoading) {
    return <Skeleton />;
  }

  if (!data || data.total_games === 0 || !root) {
    return (
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <h1 className="page-h1 flex items-center gap-2">
            <BookMarked className="h-6 w-6 text-gold-600" />
            {t('openings.title', { defaultValue: 'Openings' })}
          </h1>
          <p className="page-sub">{t('openings.subtitle', { defaultValue: 'Your repertoire as a tree.' })}</p>
        </header>
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Compass className="h-8 w-8 text-chesscom-400" />
          <div className="text-base font-semibold">
            {t('openings.empty', { defaultValue: 'No opening data yet' })}
          </div>
          <div className="max-w-md text-sm text-chesscom-500">
            {t('openings.emptyDesc', { defaultValue: 'Import or analyze a few games and your repertoire will branch out here.' })}
          </div>
          <Link to="/review" className="btn-primary mt-2 text-sm">
            {t('review.title')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1 flex items-center gap-2">
            <BookMarked className="h-6 w-6 text-gold-600" />
            {t('openings.title', { defaultValue: 'Openings' })}
          </h1>
          <p className="page-sub">{t('openings.subtitle', { defaultValue: 'Your repertoire as a tree.' })}</p>
        </div>
        <div className="text-xs text-chesscom-500">
          {t('openings.totalGames', { defaultValue: '{{n}} games in repertoire', n: data.total_games })}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Tree pane */}
        <section className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-chesscom-200 px-4 py-3 dark:border-chesscom-700">
            <Compass className="h-4 w-4 text-board-dark" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
              {t('openings.tree', { defaultValue: 'Repertoire tree' })}
            </h2>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-2">
            <TreeRow
              node={root}
              path=""
              depth={0}
              expanded={expanded}
              selectedPath={selectedPath}
              onToggle={toggle}
              onSelect={onClickNode}
              isRoot
            />
          </div>
        </section>

        {/* Detail pane */}
        <aside className="space-y-3">
          <div className={`board-theme-${user?.profile.board_theme ?? 'green'}`}>
            <ChessBoard
              fen={selectedNode?.fen || STARTING_FEN}
              movable={false}
              size={undefined}
            />
          </div>

          <DetailCard node={selectedNode} />
        </aside>
      </div>
    </div>
  );
}

function TreeRow({
  node, path, depth, expanded, selectedPath, onToggle, onSelect, isRoot = false,
  parentOpeningName = null,
}: {
  node: TreeNode;
  path: string;
  depth: number;
  expanded: Set<string>;
  selectedPath: string;
  onToggle: (path: string) => void;
  onSelect: (n: TreeNode, path: string) => void;
  isRoot?: boolean;
  parentOpeningName?: string | null;
}) {
  const { t } = useTranslation();
  const isExpanded = expanded.has(path);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedPath === path;
  // Show opening_name if it changed from parent (avoid repetition down a line).
  const showName = !isRoot && node.opening_name && node.opening_name !== parentOpeningName;

  const total = node.played || 1;
  const score = (node.wins + 0.5 * node.draws) / total;
  const scoreTone =
    score >= 0.55
      ? 'bg-board-dark/15 text-board-dark'
      : score <= 0.4
      ? 'bg-mistake/15 text-mistake'
      : 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700/40 dark:text-chesscom-300';

  // Heuristic: server caps children to 8. Show "+ N more" hint when there
  // were likely pruned siblings: when children_total < node.played and there
  // are exactly 8 children. We can't know the true count from the API, so we
  // approximate by checking sum-of-children-played vs this node's played.
  const childPlayedSum = node.children.reduce((a, c) => a + c.played, 0);
  const prunedHint = node.children.length >= 8 && childPlayedSum < node.played;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => (hasChildren ? onSelect(node, path) : onSelect(node, path))}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node, path); } }}
        className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
          isSelected
            ? 'bg-gold-500/15 text-chesscom-900 dark:text-chesscom-100'
            : 'text-chesscom-700 hover:bg-chesscom-100/60 dark:text-chesscom-200 dark:hover:bg-chesscom-700/40'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(path); }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-chesscom-400 hover:text-chesscom-700 dark:hover:text-chesscom-200"
          aria-label={isExpanded ? 'collapse' : 'expand'}
        >
          {hasChildren ? (isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
        </button>

        {isRoot ? (
          <span className="font-semibold text-chesscom-700 dark:text-chesscom-200">
            {t('openings.startPosition', { defaultValue: 'Start position' })}
          </span>
        ) : (
          <>
            <span className="font-mono text-[13px] tabular-nums text-chesscom-700 dark:text-chesscom-100">
              {moveNumberPrefix(node.ply)}{node.san}
            </span>
            {node.eco && (
              <span className="rounded bg-chesscom-100 px-1 py-px font-mono text-[11px] text-chesscom-600 dark:bg-chesscom-900/60 dark:text-chesscom-300">
                {node.eco}
              </span>
            )}
            {showName && (
              <span className="truncate text-xs text-chesscom-500">{node.opening_name}</span>
            )}
          </>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-chesscom-500">{node.played}g</span>
          <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${scoreTone}`}>
            {Math.round(score * 100)}%
          </span>
        </span>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => {
            const childPath = path ? `${path}|${child.san}` : child.san;
            return (
              <TreeRow
                key={childPath}
                node={child}
                path={childPath}
                depth={depth + 1}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
                parentOpeningName={node.opening_name}
              />
            );
          })}
          {prunedHint && (
            <div
              className="text-xs italic text-chesscom-400"
              style={{ paddingLeft: `${8 + (depth + 1) * 14 + 18}px` }}
            >
              {t('openings.moreBranches', { defaultValue: '+ more branches (rare lines hidden)' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailCard({ node }: { node: TreeNode | null }) {
  const { t } = useTranslation();
  if (!node) {
    return (
      <div className="card p-4 text-center text-sm text-chesscom-400">
        {t('openings.selectPrompt', { defaultValue: 'Click a node in the tree to inspect it.' })}
      </div>
    );
  }
  const total = node.played || 1;
  const score = (node.wins + 0.5 * node.draws) / total;
  const scoreTone =
    score >= 0.55
      ? 'text-board-dark'
      : score <= 0.4
      ? 'text-mistake'
      : 'text-chesscom-700 dark:text-chesscom-100';

  const reviewHref = node.opening_name
    ? `/review?q=${encodeURIComponent(node.opening_name)}`
    : node.eco
    ? `/review?q=${encodeURIComponent(node.eco)}`
    : '/review';

  return (
    <div className="card space-y-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          {node.eco && (
            <span className="rounded bg-chesscom-100 px-1.5 py-0.5 font-mono text-[11px] text-chesscom-600 dark:bg-chesscom-900/60 dark:text-chesscom-300">
              {node.eco}
            </span>
          )}
          <div className="truncate text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
            {node.opening_name || t('openings.unknownLine', { defaultValue: 'Untheorized line' })}
          </div>
        </div>
        {node.ply > 0 && (
          <div className="mt-1 font-mono text-xs tabular-nums text-chesscom-500">
            {t('openings.afterMove', { defaultValue: 'after {{san}}', san: `${moveNumberPrefix(node.ply)}${node.san}` })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md bg-board-dark/10 px-2 py-2">
          <div className="text-[11px] uppercase tracking-wide text-chesscom-500">{t('openings.wins', { defaultValue: 'Wins' })}</div>
          <div className="font-mono text-lg font-bold tabular-nums text-board-dark">{node.wins}</div>
        </div>
        <div className="rounded-md bg-chesscom-100/60 px-2 py-2 dark:bg-chesscom-700/40">
          <div className="text-[11px] uppercase tracking-wide text-chesscom-500">{t('openings.draws', { defaultValue: 'Draws' })}</div>
          <div className="font-mono text-lg font-bold tabular-nums text-chesscom-700 dark:text-chesscom-200">{node.draws}</div>
        </div>
        <div className="rounded-md bg-mistake/10 px-2 py-2">
          <div className="text-[11px] uppercase tracking-wide text-chesscom-500">{t('openings.losses', { defaultValue: 'Losses' })}</div>
          <div className="font-mono text-lg font-bold tabular-nums text-mistake">{node.losses}</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-chesscom-500">{t('openings.score', { defaultValue: 'Score' })}</span>
        <span className={`font-mono tabular-nums ${scoreTone}`}>{Math.round(score * 100)}%</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-chesscom-500">{t('openings.avgAccuracy', { defaultValue: 'Avg accuracy' })}</span>
        <span className="font-mono tabular-nums text-chesscom-700 dark:text-chesscom-100">
          {node.avg_accuracy != null ? `${node.avg_accuracy.toFixed(1)}%` : '—'}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-chesscom-500">{t('openings.played', { defaultValue: 'Played' })}</span>
        <span className="font-mono tabular-nums text-chesscom-700 dark:text-chesscom-100">{node.played}</span>
      </div>

      <Link to={reviewHref} className="btn-secondary w-full text-sm">
        <Target className="h-4 w-4" />
        {t('openings.trainCta', { defaultValue: 'Train these →' })}
      </Link>
    </div>
  );
}

function findNodeByPath(root: TreeNode, path: string): TreeNode | null {
  if (path === '') return root;
  const sans = path.split('|');
  let cur: TreeNode | undefined = root;
  for (const san of sans) {
    if (!cur) return null;
    cur = cur.children.find((c) => c.san === san);
  }
  return cur ?? null;
}

function moveNumberPrefix(ply: number): string {
  if (ply <= 0) return '';
  // ply 1 -> "1." (white), ply 2 -> "1...", ply 3 -> "2.", etc.
  const move = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${move}.` : `${move}…`;
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse space-y-5">
      <div className="h-7 w-40 rounded bg-chesscom-200 dark:bg-chesscom-700" />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="h-[60vh] rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
        <div className="space-y-3">
          <div className="aspect-square rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
          <div className="h-40 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
        </div>
      </div>
    </div>
  );
}
