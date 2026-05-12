import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Swords, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { useLobby, type Challenge } from '../state/lobby';

export default function IncomingChallengeModal() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const incoming = useLobby((s) => s.incoming);
  const refresh = useLobby((s) => s.refreshChallenges);

  // Show only the most-recent
  const c: Challenge | undefined = incoming[0];

  async function accept(id: number) {
    const r = await api.post<{ game_id: number }>(`/api/challenges/${id}/accept`);
    await refresh();
    nav(`/play?game=${r.game_id}`);
  }
  async function decline(id: number) {
    await api.post(`/api/challenges/${id}/decline`);
    await refresh();
  }

  return (
    <AnimatePresence>
      {c && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
        >
          <motion.div
            initial={{ y: 20, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.95 }}
            className="card w-full max-w-md overflow-hidden shadow-lift"
          >
            <div className="flex items-center gap-3 border-b border-ink-100 bg-accent-500/10 px-5 py-3 dark:border-ink-700">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/15 text-accent-600">
                <Swords className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="font-semibold leading-tight">{t('challenge.incoming')}</div>
                <div className="text-xs text-ink-500">{t('challenge.someoneChallenges')}</div>
              </div>
              <button onClick={() => decline(c.id)} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-2xl dark:bg-ink-700">
                  {c.from.avatar_emoji}
                </div>
                <div>
                  <div className="font-semibold">{c.from.display_name}</div>
                  <div className="text-xs text-ink-500">@{c.from.username}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-ink-100 px-3 py-2 dark:bg-ink-800">
                  <div className="text-[11px] uppercase tracking-wide text-ink-500">{t('play.color')}</div>
                  <div className="font-medium capitalize">{c.color === 'random' ? t('play.random') : t(`play.${c.color}`)}</div>
                </div>
                <div className="rounded-lg bg-ink-100 px-3 py-2 dark:bg-ink-800">
                  <div className="text-[11px] uppercase tracking-wide text-ink-500">{t('play.timeControl')}</div>
                  <div className="font-medium">{t(`play.tc.${c.time_control}`)}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => decline(c.id)} className="btn-secondary flex-1">{t('challenge.decline')}</button>
                <button onClick={() => accept(c.id)} className="btn-primary flex-1">{t('challenge.accept')}</button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
