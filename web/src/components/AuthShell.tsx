import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { LogoMark } from './Logo';

// Shared visual frame for the unauthenticated pages (login / signup / forgot /
// reset / verify) so they all read as the same product. Mirrors Login.tsx's
// decorative background + centered card.
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-10 dark:bg-ink-900">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-amber-200/30 blur-3xl dark:bg-amber-700/10" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-emerald-200/30 blur-3xl dark:bg-emerald-700/10" />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={64} className="mb-3" />
          <h1 className="text-3xl font-bold tracking-tight">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('app.tagline')}</p>
        </div>
        <div className="card space-y-4 p-6 shadow-lift">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
          </div>
          {children}
        </div>
        <div className="mt-6 flex justify-center gap-3 text-xs text-ink-400">
          <button type="button" onClick={() => i18n.changeLanguage('en')} className={`px-2 py-1 ${i18n.language === 'en' ? 'text-ink-700 underline dark:text-ink-200' : 'hover:text-ink-700'}`}>EN</button>
          <span>·</span>
          <button type="button" onClick={() => i18n.changeLanguage('bg')} className={`px-2 py-1 ${i18n.language === 'bg' ? 'text-ink-700 underline dark:text-ink-200' : 'hover:text-ink-700'}`}>BG</button>
        </div>
      </motion.div>
    </div>
  );
}
