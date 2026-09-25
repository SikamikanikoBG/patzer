import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from '../lib/languages';
import { Volume2, Save, User as UserIcon, Palette, Sparkles, Type, Check, Smile } from 'lucide-react';
import { api } from '../api';
import { useAuth, type Profile, type BoardTheme, type SiteTheme, type SoundSet, type MoveSoundSet } from '../state/auth';
import { getVoices, onVoicesReady, speak } from '../lib/tts';
import { moveSoundsReady, playSound, setMoveSoundSet, setSoundSet } from '../lib/sounds';

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
      sound_enabled: !!form.sound_enabled,
      sound_set: form.sound_set,
      move_sound_set: form.move_sound_set,
      blunder_warning: !!form.blunder_warning,
      kid_piece_emotions: !!form.kid_piece_emotions,
    });
    await i18n.changeLanguage(form.language);
    await refresh();
    setSaved(true); setDirty(false);
    setTimeout(() => setSaved(false), 1800);
  }

  const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(form.language));

  // Play check then game-end in the given set, then fall back to the saved
  // set so an unsaved preview doesn't leak into the next game.
  function previewSoundSet(s: SoundSet) {
    setSoundSet(s);
    playSound('check');
    window.setTimeout(() => playSound('game_end'), 700);
    window.setTimeout(() => setSoundSet(user?.profile.sound_set ?? 'classic'), 2500);
  }

  // Same idea for moves: a move, a capture and a castle in the given set.
  // Waits for the recordings first so 'board' isn't previewed as the synth.
  async function previewMoveSoundSet(s: MoveSoundSet) {
    setMoveSoundSet(s);
    await moveSoundsReady();
    playSound('move');
    window.setTimeout(() => playSound('capture'), 550);
    window.setTimeout(() => playSound('castle'), 1100);
    window.setTimeout(() => setMoveSoundSet(user?.profile.move_sound_set ?? 'classic'), 2000);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <header>
        <h1 className="page-h1">{t('settings.title')}</h1>
        <p className="page-sub">{t('settings.subtitle')}</p>
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
            <div className="section-desc">{t('settings.profileDesc')}</div>
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
            <select className="input" value={form.language} onChange={(e) => set('language', e.target.value as Language)}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.native}</option>)}
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
            <div className="section-desc">{t('settings.appearanceDesc')}</div>
          </div>
        </div>
        <div className="space-y-6 p-5">
          <div>
            <label className="label mb-2 block">{t('settings.siteTheme')}</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(['light','dark','auto'] as SiteTheme[]).map((th) => (
                <SiteThemeOption key={th} value={th} selected={form.site_theme === th} onPick={() => set('site_theme', th)} label={t(`settings.siteTheme${th[0]!.toUpperCase()}${th.slice(1)}`)} />
              ))}
            </div>
          </div>
          <div>
            <label className="label mb-2 block">{t('settings.boardTheme')}</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <div className="section-desc">{t('settings.coachDesc')}</div>
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
                  {t(`settings.behaviorDesc.${b}`)}
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
            <div className="section-title">{t('settings.soundAssist')}</div>
            <div className="section-desc">{t('settings.soundAssistDesc')}</div>
          </div>
        </div>
        <div className="space-y-3 p-5">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-ink-50 dark:hover:bg-ink-700/50">
            <input type="checkbox" className="mt-1" checked={!!form.sound_enabled} onChange={(e) => set('sound_enabled', e.target.checked ? 1 : 0)} />
            <div>
              <div className="text-sm font-medium">{t('settings.soundEffects')}</div>
              <div className="text-xs text-ink-500">{t('settings.soundEffectsDesc')}</div>
            </div>
          </label>
          {!!form.sound_enabled && (
            <div className="space-y-3 pl-8">
              <SoundChoice label={t('settings.moveSoundSet')} options={['classic', 'board'] as const} value={form.move_sound_set}
                optionText={(s) => t(`settings.moveSoundSetOption.${s}`)} descText={(s) => t(`settings.moveSoundSetDesc.${s}`)}
                previewText={t('settings.soundSetPreview')}
                onPick={(s) => set('move_sound_set', s)} onPreview={(s) => void previewMoveSoundSet(s)} />
              <SoundChoice label={t('settings.soundSet')} options={['classic', 'soft'] as const} value={form.sound_set}
                optionText={(s) => t(`settings.soundSetOption.${s}`)} descText={(s) => t(`settings.soundSetDesc.${s}`)}
                previewText={t('settings.soundSetPreview')}
                onPick={(s) => set('sound_set', s)} onPreview={previewSoundSet} />
            </div>
          )}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-ink-50 dark:hover:bg-ink-700/50">
            <input type="checkbox" className="mt-1" checked={!!form.blunder_warning} onChange={(e) => set('blunder_warning', e.target.checked ? 1 : 0)} />
            <div>
              <div className="text-sm font-medium">{t('settings.blunderWarning')}</div>
              <div className="text-xs text-ink-500">{t('settings.blunderWarningDesc')}</div>
            </div>
          </label>
        </div>
      </section>

      {/* Living pieces — only for the kid audience. The toggle is gated on
          `audience === 'kid'` so older players don't see a feature meant for
          7-10 year olds. The previews are static SVGs of the actual moods. */}
      {form.audience === 'kid' && (
        <section className="card overflow-hidden">
          <div className="section-header">
            <div className="section-icon bg-pink-500/15 text-pink-600"><Smile className="h-4 w-4" /></div>
            <div>
              <div className="section-title">{t('settings.kidEmotions')}</div>
              <div className="section-desc">{t('settings.kidEmotionsDesc')}</div>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-ink-50 dark:hover:bg-ink-700/50">
              <input
                type="checkbox"
                className="mt-1"
                checked={!!form.kid_piece_emotions}
                onChange={(e) => set('kid_piece_emotions', e.target.checked ? 1 : 0)}
              />
              <div>
                <div className="text-sm font-medium">{t('settings.kidEmotionsEnable')}</div>
                <div className="text-xs text-ink-500">{t('settings.kidEmotionsEnableHelp')}</div>
              </div>
            </label>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MoodPreview moodClass="mood-hero"     glyph="🦸" title={t('settings.mood.hero')}     desc={t('settings.mood.heroDesc')} />
              <MoodPreview moodClass="mood-stressed" glyph="😱" title={t('settings.mood.stressed')} desc={t('settings.mood.stressedDesc')} />
              <MoodPreview moodClass="mood-guarding" glyph="🛡️" title={t('settings.mood.guarding')} desc={t('settings.mood.guardingDesc')} />
              <MoodPreview moodClass="mood-sleeping" glyph="💤" title={t('settings.mood.sleeping')} desc={t('settings.mood.sleepingDesc')} />
            </div>
          </div>
        </section>
      )}

      {/* Voice */}
      <section className="card overflow-hidden">
        <div className="section-header">
          <div className="section-icon bg-amber-500/15 text-amber-600"><Type className="h-4 w-4" /></div>
          <div>
            <div className="section-title">{t('settings.tts')}</div>
            <div className="section-desc">{t('settings.ttsDesc')}</div>
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
                  <p className="mt-1 text-xs text-ink-400">{t('settings.ttsNoVoices')}</p>
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
                const text = i18n.getFixedT(form.language)('settings.ttsPreviewText');
                speak(text, { voice: form.tts_voice, rate: form.tts_rate, pitch: form.tts_pitch, lang: form.language });
              }} className="btn-secondary self-start text-sm">
                <Volume2 className="h-4 w-4" /> {t('settings.ttsPreview')}
              </button>
            </>
          )}
        </div>
      </section>

      {/* Sticky save bar — uses position:sticky inside the form column so the
          mobile soft keyboard pushes the page (and the bar) up naturally rather
          than the bar floating over the focused input. The aria-live region
          announces "Saved" to screen readers without stealing focus. */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-ink-200 bg-cream/95 px-4 py-3 backdrop-blur sm:-mx-0 sm:rounded-b-2xl dark:border-ink-700 dark:bg-ink-900/95"
           style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="text-sm text-ink-500" aria-live="polite">
            {saved ? <span className="inline-flex items-center gap-1 text-accent-600"><Check className="h-4 w-4" />{t('settings.saved')}</span>
              : dirty ? t('settings.unsaved') : t('settings.noChanges')}
          </div>
          <button onClick={save} disabled={!dirty} className="btn-primary">
            <Save className="h-4 w-4" /> {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function MoodPreview({ moodClass, glyph, title, desc }: { moodClass: string; glyph: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-ink-200 bg-white p-3 text-center dark:border-ink-700 dark:bg-ink-800">
      <div className={`relative mb-2 h-9 w-9 ${moodClass}`}>
        <span className="mood-glyph" style={{ fontSize: 18 }}>{glyph}</span>
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-xs leading-snug text-ink-500">{desc}</div>
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

// Two option cards side by side, each with its own preview button — used for
// the move sounds and for the check / game-end sounds.
function SoundChoice<T extends string>({ label, options, value, optionText, descText, previewText, onPick, onPreview }: {
  label: string;
  options: readonly T[];
  value: T;
  optionText: (o: T) => string;
  descText: (o: T) => string;
  previewText: string;
  onPick: (o: T) => void;
  onPreview: (o: T) => void;
}) {
  return (
    <div>
      <label className="label mb-1 block">{label}</label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <div key={o} className={`flex items-start gap-2 rounded-xl border p-3 text-sm transition-colors
            ${value === o
              ? 'border-ink-900 bg-ink-900 text-cream dark:border-cream dark:bg-cream dark:text-ink-900'
              : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-800 dark:hover:border-ink-600'}`}>
            <button type="button" onClick={() => onPick(o)} className="min-w-0 flex-1 text-left">
              <div className="font-medium">{optionText(o)}</div>
              <div className={`mt-1 text-xs ${value === o ? 'opacity-80' : 'text-ink-500'}`}>{descText(o)}</div>
            </button>
            <button type="button" onClick={() => onPreview(o)} className="shrink-0 rounded-md p-1 opacity-80 hover:opacity-100"
              title={previewText} aria-label={previewText}>
              <Volume2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
