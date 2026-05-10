// Shortcuts modal — opened by ?
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { X } from 'lucide-react';

interface Props { open: boolean; onClose: () => void }

export default function ShortcutsModal({ open, onClose }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: t('shortcuts.global', { defaultValue: 'Global' }),
      rows: [
        ['⌘ K · Ctrl K', t('shortcuts.openPalette', { defaultValue: 'Command palette' })],
        ['?', t('shortcuts.openShortcuts', { defaultValue: 'Show this dialog' })],
        ['G H', t('shortcuts.goHome', { defaultValue: 'Go to Home' })],
        ['G P', t('shortcuts.goPlay', { defaultValue: 'Go to Play' })],
        ['G R', t('shortcuts.goReview', { defaultValue: 'Go to Review' })],
        ['G I', t('shortcuts.goInsights', { defaultValue: 'Go to Insights' })],
        ['G T', t('shortcuts.goTrain', { defaultValue: 'Go to Tactic Trainer' })],
        ['Esc', t('shortcuts.closeDialog', { defaultValue: 'Close any dialog' })],
      ],
    },
    {
      title: t('shortcuts.review', { defaultValue: 'Game Review' }),
      rows: [
        ['←  →', t('shortcuts.prevNext', { defaultValue: 'Previous / Next move' })],
        ['Home  End', t('shortcuts.firstLast', { defaultValue: 'First / Last position' })],
        ['F', t('shortcuts.flipBoard', { defaultValue: 'Flip board' })],
        ['B', t('shortcuts.bookmark', { defaultValue: 'Toggle bookmark' })],
        ['S', t('shortcuts.share', { defaultValue: 'Copy link to position' })],
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-chesscom-200 bg-white shadow-lift dark:border-chesscom-700 dark:bg-chesscom-800 animate-fade-in">
        <div className="flex items-center justify-between border-b border-chesscom-200 px-4 py-3 dark:border-chesscom-700">
          <h2 className="text-sm font-semibold">{t('shortcuts.title', { defaultValue: 'Keyboard shortcuts' })}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-chesscom-400 hover:bg-chesscom-100 dark:hover:bg-chesscom-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-5">
          {groups.map((g) => (
            <section key={g.title}>
              <div className="mb-2 text-[10px] uppercase tracking-wider text-chesscom-500">{g.title}</div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {g.rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 rounded-md bg-chesscom-50/70 px-3 py-1.5 text-xs dark:bg-chesscom-900/40">
                    <span className="text-chesscom-600 dark:text-chesscom-200">{v}</span>
                    <kbd className="font-mono text-[11px] text-chesscom-700 dark:text-chesscom-200">{k}</kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
