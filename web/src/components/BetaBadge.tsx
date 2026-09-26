import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

// Marks a feature that works but is still being refined (opening trainer,
// Learn section), so feedback is expected rather than a surprise.
export default function BetaBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      title={t('common.betaHint')}
      className={cn('badge bg-accent-500/15 uppercase tracking-wide text-[10px] text-accent-700 dark:text-accent-300', className)}
    >
      {t('common.beta')}
    </span>
  );
}
