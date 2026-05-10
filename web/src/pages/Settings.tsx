import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, Save, User as UserIcon, Palette, Sparkles, Type, Check } from 'lucide-react';
import { api } from '../api';
import { useAuth, type Profile, type BoardTheme, type SiteTheme } from '../state/auth';
import { getVoices, onVoicesReady, speak } from '../lib/tts';

const EMOJIS = ['♟','♞','♝','♜','♛','♚','🦊','🐯','🦁','🐻','🐼','🐰','🐶','🐱','🐹','🐢','🐧','🐳','⭐','🌟'];

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useAuth();
  const [form, setForm] = useState<Profile | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (user) setForm({ ...user.profile }); }, [user]);
  useEffect(() => onVoicesReady(() => setVoices(getVoices())), []);

  if (!form) return null;

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setForm((f) => f ? { ...f, [k]: v } : f);
    setSaved(false); setDirty(true);
  }

  async function save() {
    if (!form) return;
    await api.patch('/api/settings/profile', {
      display_name: form.display_name,
      avatar_emoji: form.avatar_emoji,
      language: form.language,
      audience: form.audience,
      chesscom_username: form.chesscom_username || null,
      coach_behavior: form.coach_behavior,
      tts_enabled: !!form.tts_enabled,
      tts_voice: form.tts_voice,
      tts_rate: form.tts_rate,
      tts_pitch: form.tts_pitch,
      board_theme: form.board_theme,
      piece_set: form.piece_set,
      site_theme: form.site_theme,
    });
    await i18n.changeLanguage(form.language);
    await refresh();
    setSaved(true); setDirty(false);
    setTimeout(() => setSaved(false), 1800);
  }

  const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(form.language === 'bg' ? 'bg' : 'en'));

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <header>
        <h1 className="page-h1">{t('settings.title')}</h1>
        <p className="page-sub">Personalize how chess looks, sounds, and how the coach talks to you.</p>
      </header>

      {user?.role === 'admin' && (
        <div className="flex items-start gap-3 rounded-xl border border-accent-500/30 bg-accent-50/70 px-4 py-3 text-sm text-accent-700 dark:bg-accent-700/10 dark:text-accent-300">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{t('settings.adminHint')}</div>
        </div>
      )}

      {/* Profile */}
      <section className="card overflow-hidden">
        <div className="section-header">
          <div className="section-icon bg-accent-500/15 text-accent-600"><UserIcon className="h-4 w-4" /></div>
          <div>
            <div className="section-title">{t('settings.profile')}</div>
            <div className="section-desc">Your display info and language for the interface.</div>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-100 text-3xl dark:bg-ink-700">
              {form.avatar_emoji}
            </div>
            <div className="flex-1">
              <label className="label mb-1 block">{t('settings.displayName')}</label>
              <input className="input" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label mb-1 block">{t('settings.avatar')}</label>
            <div className="flex flex-wrap gap-1">
              {EMOJIS.map((emoji) => (
                <button key={emoji} type="button" onClick={() => set('avatar_emoji', emoji)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl transition-colors
                    ${form.avatar_emoji === emoji ? 'bg-ink-900 text-cream ring-2 ring-accent-500/30 dark:bg-cream dark:text-ink-900' : 'hover:bg-ink-100 dark:hover:bg-ink-800'}`}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label mb-1 block">{t('settings.language')}</label>
            <select className="input" value={form.language} onChange={(e) => set('language', e.target.value as 'en' | 'bg')}>
              <option value="en">{t('common.english')}</option>
              <option value="bg">{t('common.bulgarian')}</option>
            </select>
          </div>
          <div>
            <label className="label mb-1 block">{t('settings.audience')}</label>
            <select className="input" value={form.audience} onChange={(e) => set('audience', e.target.value as Profile['audience'])}>
              <option value="kid">{t('settings.audienceLevel.kid')}</option>
              <option value="beginner">{t('settings.audienceLevel.beginner')}</option>
              <option value="intermediate">{t('settings.audienceLevel.intermediate')}</option>
              <option value="advanced">{t('settings.audienceLevel.advanced')}</option>
            </select>
            <div className="mt-1 text-xs text-ink-400">{t('settings.audienceHelp')}</div>
          </div>
          <div className="sm:col-span-2">
            <label className="label mb-1 block">{t('settings.chessCom')}</label>
            <input className="input" value={form.chesscom_username ?? ''} onChange={(e) => set('chesscom_username', e.target.value)} placeholder="username" />
            <div className="mt-1 text-xs text-ink-400">{t('settings.chessComHelp')}</div>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="card overflow-hidden">
        <div className="section-header">
          <div className="section-icon bg-purple-500/15 text-purple-600"><Palette className="h-4 w-4" /></div>
          <div>
            <div className="section-title">{t('settings.appearance')}</div>
            <div className="section-desc">Pick a site theme and a board you'll enjoy looking at.</div>
          </div>
        </div>
        <div className="space-y-6 p-5">
          <div>
            <label className="label mb-2 block">{t('settings.siteTheme')}</label>
            <div className="grid grid-cols-3 gap-3">
              {(['light','dark','auto'] as SiteTheme[]).map((th) => (
                <SiteThemeOption key={th} value={th} selected={form.site_theme === th} onPick={() => set('site_theme', th)} label={t(`settings.siteTheme${th[0]!.toUpperCase()}${th.slice(1)}`)} />
              ))}
            </div>
          </div>
          <div>
            <label className="label mb-2 block">{t('settings.boardTheme')}</label>
            <div className="grid grid-cols-3 gap-3">
              {(['wood','green','blue'] as BoardTheme[]).map((th) => (
                <BoardThemeOption key={th} value={th} selected={form.board_theme === th} onPick={() => set('board_theme', th)} label={t(`settings.board${th[0]!.toUpperCase()}${th.slice(1)}`)} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Coach */}
      <section className="card overflow-hidden">
        <div className="section-header">
          <div className="section-icon bg-emerald-500/15 text-emerald-600"><Sparkles className="h-4 w-4" /></div>
          <div>
            <div className="section-title">{t('coach.title')}</div>
            <div className="section-desc">How the AI Coach interacts during games and reviews.</div>
          </div>
        </div>
        <div className="space-y-3 p-5">
          <label className="label mb-1 block">{t('settings.coachBehavior')}</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['silent','on_demand','always_on_pedagogical'] as const).map((b) => (
              <button key={b} type="button" onClick={() => set('coach_behavior', b)}
                className={`rounded-xl border p-3 text-left text-sm transition-colors
                  ${form.coach_behavior === b
                    ? 'border-ink-900 bg-ink-900 text-cream dark:border-cream dark:bg-cream dark:text-ink-900'
                    : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-800 dark:hover:border-ink-600'}`}>
                <div className="font-medium">{t(`coach.behavior.${b}`)}</div>
                <div className={`mt-1 text-xs ${form.coach_behavior === b ? 'opacity-80' : 'text-ink-500'}`}>
                  {b === 'silent' && 'Coach won\'t speak or appear during games.'}
                  {b === 'on_demand' && 'Coach is silent until you ask for a hint or explanation.'}
                  {b === 'always_on_pedagogical' && 'Coach narrates the game in a teaching voice. Best for learners.'}
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Sound + warnings */}
      <section className="card overflow-hidden">
        <div className="section-header">
          <div className="section-icon bg-blue-500/15 text-blue-600"><Sparkles className="h-4 w-4" /></div>
          <div>
            <div className="section-title">Sound & assistance</div>
            <div className="section-desc">Audio feedback and learning aids during play.</div>
          </div>
        </div>
        <div className="space-y-3 p-5">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-ink-50 dark:hover:bg-ink-700/50">
            <input type="checkbox" className="mt-1" checked={!!form.sound_enabled} onChange={(e) => set('sound_enabled', e.target.checked ? 1 : 0)} />
            <div>
              <div className="text-sm font-medium">Sound effects</div>
              <div className="text-xs text-ink-500">Play piece-move, capture, check, castle and game-end sounds.</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-ink-50 dark:hover:bg-ink-700/50">
            <input type="checkbox" className="mt-1" checked={!!form.blunder_warning} onChange={(e) => set('blunder_warning', e.target.checked ? 1 : 0)} />
            <div>
              <div className="text-sm font-medium">Blunder warning before move</div>
              <div className="text-xs text-ink-500">When playing, the engine quickly checks your move. If it looks like a mistake or blunder, ask before committing. Recommended for kids and beginners.</div>
            </div>
          </label>
        </div>
      </section>

      {/* Voice */}
      <section className="card overflow-hidden">
        <div className="section-header">
          <div className="section-icon bg-amber-500/15 text-amber-600"><Type className="h-4 w-4" /></div>
          <div>
            <div className="section-title">{t('settings.tts')}</div>
            <div className="section-desc">Coach can read its explanations aloud. Uses your operating system's voices.</div>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={!!form.tts_enabled} onChange={(e) => set('tts_enabled', e.target.checked ? 1 : 0)} />
            <span className="text-sm">{t('settings.ttsEnable')}</span>
          </label>
          {!!form.tts_enabled && (
            <>
              <div>
                <label className="label mb-1 block">{t('settings.ttsVoice')}</label>
                <select className="input" value={form.tts_voice ?? ''} onChange={(e) => set('tts_voice', e.target.value || null)}>
                  <option value="">{t('settings.ttsVoiceNone')}</option>
                  {langVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                  ))}
                </select>
                {langVoices.length === 0 && (
                  <p className="mt-1 text-xs text-ink-400">No voices found for this language. Install the OS language pack to see more options.</p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label mb-1 block">{t('settings.ttsRate')}: <span className="font-mono text-ink-700 dark:text-ink-200">{form.tts_rate.toFixed(2)}</span></label>
                  <input type="range" min={0.5} max={2} step={0.05} value={form.tts_rate} onChange={(e) => set('tts_rate', Number(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="label mb-1 block">{t('settings.ttsPitch')}: <span className="font-mono text-ink-700 dark:text-ink-200">{form.tts_pitch.toFixed(2)}</span></label>
                  <input type="range" min={0} max={2} step={0.05} value={form.tts_pitch} onChange={(e) => set('tts_pitch', Number(e.target.value))} className="w-full" />
                </div>
              </div>
              <button onClick={() => {
                const text = form.language === 'bg' ? t('settings.ttsPreviewTextBg') : t('settings.ttsPreviewText');
                speak(text, { voice: form.tts_voice, rate: form.tts_rate, pitch: form.tts_pitch, lang: form.language });
              }} className="btn-secondary self-start text-sm">
                <Volume2 className="h-4 w-4" /> {t('settings.ttsPreview')}
              </button>
            </>
          )}
        </div>
      </section>

      {/* Sticky save */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-cream/95 px-4 py-3 backdrop-blur dark:border-ink-700 dark:bg-ink-900/95">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="text-sm text-ink-500">
            {saved ? <span className="inline-flex items-center gap-1 text-accent-600"><Check className="h-4 w-4" />{t('settings.saved')}</span>
              : dirty ? 'Unsaved changes' : 'No changes'}
          </div>
          <button onClick={save} disabled={!dirty} className="btn-primary">
            <Save className="h-4 w-4" /> {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SiteThemeOption({ value, selected, onPick, label }: { value: SiteTheme; selected: boolean; onPick: () => void; label: string }) {
  return (
    <button type="button" onClick={onPick}
      className={`group relative overflow-hidden rounded-xl border p-2 text-xs font-medium transition-all
        ${selected ? 'border-ink-900 ring-2 ring-accent-500/30 dark:border-cream' : 'border-ink-200 hover:border-ink-300 dark:border-ink-700 dark:hover:border-ink-600'}`}>
      <div className="relative h-16 overflow-hidden rounded-lg">
        {value === 'light' && <div className="h-full w-full bg-gradient-to-br from-cream to-amber-50">
          <div className="absolute inset-x-2 top-2 h-1 rounded bg-ink-200" />
          <div className="absolute inset-x-2 top-4 h-1 w-12 rounded bg-ink-300" />
          <div className="absolute bottom-2 left-2 h-3 w-3 rounded-full bg-accent-500" />
        </div>}
        {value === 'dark' && <div className="h-full w-full bg-gradient-to-br from-ink-900 to-ink-800">
          <div className="absolute inset-x-2 top-2 h-1 rounded bg-ink-700" />
          <div className="absolute inset-x-2 top-4 h-1 w-12 rounded bg-ink-600" />
          <div className="absolute bottom-2 left-2 h-3 w-3 rounded-full bg-accent-500" />
        </div>}
        {value === 'auto' && <div className="grid h-full w-full grid-cols-2">
          <div className="bg-cream"><div className="m-2 h-1 w-8 rounded bg-ink-300" /></div>
          <div className="bg-ink-900"><div className="m-2 h-1 w-8 rounded bg-ink-600" /></div>
        </div>}
        {selected && (
          <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-white shadow">
            <Check className="h-3 w-3" />
          </div>
        )}
      </div>
      <div className="mt-2">{label}</div>
    </button>
  );
}

function BoardThemeOption({ value, selected, onPick, label }: { value: BoardTheme; selected: boolean; onPick: () => void; label: string }) {
  const colors = {
    wood:  { l: '#f0d9b5', d: '#b58863' },
    green: { l: '#eeeed2', d: '#769656' },
    blue:  { l: '#dee3e6', d: '#788a94' },
  }[value];
  return (
    <button type="button" onClick={onPick}
      className={`group relative overflow-hidden rounded-xl border p-2 text-xs font-medium transition-all
        ${selected ? 'border-ink-900 ring-2 ring-accent-500/30 dark:border-cream' : 'border-ink-200 hover:border-ink-300 dark:border-ink-700 dark:hover:border-ink-600'}`}>
      <div className="relative">
        <div className="grid aspect-square w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-lg shadow-inner">
          {Array.from({ length: 64 }).map((_, i) => {
            const x = i % 8; const y = Math.floor(i / 8);
            const isDark = (x + y) % 2 === 1;
            return <div key={i} style={{ background: isDark ? colors.d : colors.l }} />;
          })}
        </div>
        {selected && (
          <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-white shadow">
            <Check className="h-3 w-3" />
          </div>
        )}
      </div>
      <div className="mt-2">{label}</div>
    </button>
  );
}
