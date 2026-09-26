// Learn — interactive lessons from "how does the rook move" to rook endgames
// (roadmap #7). One page: the overview of all levels and courses, one course
// with its lessons (?course=…), or a lesson being played (?lesson=…).
// Progress is one server-side row per lesson (see server/src/learnProgress.ts).

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, GraduationCap, Play, RotateCcw, Star, Trophy } from 'lucide-react';
import { api } from '../api';
import { normalizeLanguage } from '../lib/languages';
import { cn } from '../lib/utils';
import BetaBadge from '../components/BetaBadge';
import LessonPlayer, { LEARN_QUERY_KEY } from '../components/learn/LessonPlayer';
import LessonIcon, { LEVEL_COLORS, PieceIcon } from '../components/learn/LessonIcon';
import { loadCurriculum, loadLearnTexts, type Curriculum, type LessonRef } from '../learn/content';
import { levelOf, levelPiece } from '../learn/engine';
import type { CourseDef, LevelDef } from '../learn/types';

export interface LessonProgress {
  lesson_id: string;
  step: number;
  flawed: number;
  stars: number;
  completed_at: string | null;
  updated_at: string;
}

export const fetchLearnProgress = () => api.get<{ lessons: LessonProgress[] }>('/api/learn');

/** Curriculum + lesson texts in the current language, loaded on demand. */
export function useLearnContent(): { cur: Curriculum | null; failed: boolean } {
  const { i18n } = useTranslation();
  const lang = normalizeLanguage(i18n.language);
  const [cur, setCur] = useState<Curriculum | null>(null);
  const [textsFor, setTextsFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { loadCurriculum().then(setCur).catch(() => setFailed(true)); }, []);
  useEffect(() => {
    let live = true;
    loadLearnTexts(lang).then(() => { if (live) setTextsFor(lang); }).catch(() => setFailed(true));
    return () => { live = false; };
  }, [lang]);
  return { cur: cur && textsFor === lang ? cur : null, failed };
}

/** The lesson to suggest: one you're in the middle of, else the first one
 *  you haven't finished yet. */
export function suggestedLesson(cur: Curriculum, progress: Map<string, LessonProgress>): LessonRef | null {
  const started = [...progress.values()]
    .filter((p) => p.step > 0 && cur.byId.has(p.lesson_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (started) return cur.byId.get(started.lesson_id)!;
  return cur.lessons.find((r) => !progress.get(r.lesson.id)?.completed_at) ?? null;
}

export default function Learn() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const lessonId = params.get('lesson');
  const courseId = params.get('course');
  const { cur, failed } = useLearnContent();
  const { data, isLoading, isError } = useQuery({ queryKey: LEARN_QUERY_KEY, queryFn: fetchLearnProgress });

  const progress = useMemo(() => new Map((data?.lessons ?? []).map((r) => [r.lesson_id, r])), [data]);
  // Only lessons that still exist count (a lesson could be renamed one day).
  const totalStars = useMemo(
    () => (cur ? [...progress.values()].filter((p) => cur.byId.has(p.lesson_id)).reduce((s, p) => s + p.stars, 0) : 0),
    [cur, progress],
  );

  useEffect(() => { window.scrollTo({ top: 0 }); }, [lessonId, courseId]);

  if (failed || isError) return <div className="card p-10 text-center text-sm text-move-mistake">{t('learn.loadError')}</div>;
  if (!cur || isLoading) return <div className="card p-10 text-center text-sm text-chesscom-500">{t('common.loading')}</div>;

  const openLesson = (id: string) => setParams({ lesson: id });
  const openCourse = (id: string) => setParams({ course: id });

  const ref = lessonId ? cur.byId.get(lessonId) : undefined;
  if (ref) {
    const row = progress.get(ref.lesson.id);
    const resume = row && row.step > 0 && row.step < ref.lesson.steps.length
      ? { step: row.step, flawed: row.flawed }
      : { step: 0, flawed: 0 };
    return (
      <LessonPlayer
        key={ref.lesson.id}
        refInfo={ref}
        resume={resume}
        bestStars={row?.stars ?? 0}
        totalStars={totalStars}
        next={cur.lessons[ref.order + 1] ?? null}
        onOpenLesson={openLesson}
        onExit={() => openCourse(ref.course.id)}
      />
    );
  }

  const course = courseId ? cur.courseById.get(courseId) : undefined;
  if (course) {
    return (
      <CourseView
        course={course.course}
        level={course.level}
        cur={cur}
        progress={progress}
        onOpen={openLesson}
        onBack={() => setParams({})}
      />
    );
  }

  return <Overview cur={cur} progress={progress} totalStars={totalStars} onOpenLesson={openLesson} onOpenCourse={openCourse} />;
}

// ---- Overview ------------------------------------------------------------------

function courseStats(course: CourseDef, progress: Map<string, LessonProgress>) {
  const done = course.lessons.filter((l) => progress.get(l.id)?.completed_at).length;
  const stars = course.lessons.reduce((s, l) => s + (progress.get(l.id)?.stars ?? 0), 0);
  return { done, total: course.lessons.length, stars, maxStars: course.lessons.length * 3 };
}

function Overview({ cur, progress, totalStars, onOpenLesson, onOpenCourse }: {
  cur: Curriculum;
  progress: Map<string, LessonProgress>;
  totalStars: number;
  onOpenLesson: (id: string) => void;
  onOpenCourse: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { t: tl } = useTranslation('learn');
  const lvl = levelOf(totalStars);
  const done = cur.lessons.filter((r) => progress.get(r.lesson.id)?.completed_at).length;
  const next = suggestedLesson(cur, progress);
  const nextRow = next ? progress.get(next.lesson.id) : undefined;
  const pct = ((totalStars - lvl.floor) / (lvl.next - lvl.floor)) * 100;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-chesscom-900 via-[#3b4c2f] to-board-dark p-6 text-white shadow-lift sm:p-8"
      >
        <div className="grid gap-6 md:grid-cols-[1fr_minmax(260px,340px)] md:items-center">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
              <GraduationCap className="h-7 w-7 text-gold-300" /> {t('learn.title')}
              <BetaBadge className="bg-white/15 text-white dark:text-white" />
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">{t('learn.subtitle')}</p>
            {next && (
              <button
                onClick={() => onOpenLesson(next.lesson.id)}
                className="group mt-5 inline-flex items-center gap-2 rounded-md bg-green-500 px-5 py-2.5 text-sm font-bold text-white shadow-soft transition-all hover:bg-green-600 hover:shadow-lift"
              >
                <Play className="h-4 w-4 fill-current" />
                {nextRow && nextRow.step > 0 ? t('learn.resumeLesson') : done ? t('learn.nextUp') : t('learn.startHere')}: {tl(`${next.lesson.id}.title`)}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            )}
            {!next && (
              <div className="mt-5 inline-flex items-center gap-2 rounded-md bg-white/10 px-4 py-2 text-sm font-semibold">
                <Trophy className="h-4 w-4 text-gold-300" /> {t('learn.allDone')}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white/10 p-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 16 }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-500/20 ring-2 ring-gold-500/70"
              >
                <PieceIcon piece={levelPiece(lvl.level)} className="h-10 w-10" />
              </motion.div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.16em] text-white/55">{t('learn.yourLevel')}</div>
                <div className="text-xl font-bold">{t('learn.level', { n: lvl.level })}</div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-1 font-mono text-xl font-semibold tabular-nums">
                  <Star className="h-4 w-4 fill-gold-500 text-gold-300" /> {totalStars}
                </div>
                <div className="text-[11px] text-white/55">{t('learn.lessonsDone', { done, total: cur.lessons.length })}</div>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ delay: 0.3, duration: 0.7, ease: 'easeOut' }}
                className="h-full rounded-full bg-gold-500"
              />
            </div>
            <div className="mt-1.5 text-[11px] text-white/60">{t('learn.toNextLevel', { count: lvl.next - totalStars, n: lvl.level + 1 })}</div>
          </div>
        </div>
      </motion.section>

      {cur.levels.filter((level) => level.courses.length > 0).map((level, li) => (
        <LevelSection key={level.id} level={level} index={li} progress={progress} onOpenCourse={onOpenCourse} />
      ))}
    </div>
  );
}

function LevelSection({ level, index, progress, onOpenCourse }: {
  level: LevelDef;
  index: number;
  progress: Map<string, LessonProgress>;
  onOpenCourse: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { t: tl } = useTranslation('learn');
  const color = LEVEL_COLORS[level.id];
  const lessons = level.courses.flatMap((c) => c.lessons);
  const done = lessons.filter((l) => progress.get(l.id)?.completed_at).length;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.06, duration: 0.3 }}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: color.solid }} />
          <div>
            <h2 className="text-lg font-bold tracking-tight">{t(`learn.levels.${level.id}.title`)}</h2>
            <p className="text-xs text-chesscom-500">{t(`learn.levels.${level.id}.desc`)}</p>
          </div>
        </div>
        <span className="font-mono text-xs tabular-nums text-chesscom-500">{t('learn.lessonsDone', { done, total: lessons.length })}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {level.courses.map((course) => {
          const s = courseStats(course, progress);
          const complete = s.done === s.total;
          return (
            <button key={course.id} onClick={() => onOpenCourse(course.id)} className="card-hover flex flex-col p-4 text-left">
              <div className="flex items-start gap-3">
                <LessonIcon icon={course.icon} level={level.id} done={complete} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
                    <span className="truncate">{tl(`courses.${course.id}.title`)}</span>
                    {complete && <Check className="h-4 w-4 shrink-0 text-green-500" />}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-chesscom-500">{tl(`courses.${course.id}.desc`)}</p>
                </div>
              </div>
              <div className="mt-auto pt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(s.done / s.total) * 100}%`, backgroundColor: color.solid }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-chesscom-500">
                  <span>{t('learn.lessonsDone', { done: s.done, total: s.total })}</span>
                  <span className="flex items-center gap-0.5 font-mono tabular-nums">
                    <Star className="h-3 w-3 fill-gold-500 text-gold-600" /> {s.stars}/{s.maxStars}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </motion.section>
  );
}

// ---- One course ------------------------------------------------------------------

function CourseView({ course, level, cur, progress, onOpen, onBack }: {
  course: CourseDef;
  level: LevelDef;
  cur: Curriculum;
  progress: Map<string, LessonProgress>;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { t: tl } = useTranslation('learn');
  const s = courseStats(course, progress);
  const color = LEVEL_COLORS[level.id];
  const suggested = suggestedLesson(cur, progress);
  // Within this course: the lesson to do next (the site-wide suggestion if it
  // is in here, else the first unfinished one).
  const nextId = suggested && suggested.course.id === course.id
    ? suggested.lesson.id
    : course.lessons.find((l) => !progress.get(l.id)?.completed_at)?.id;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-chesscom-500 hover:text-chesscom-800 dark:hover:text-chesscom-200">
        <ArrowLeft className="h-4 w-4" /> {t('learn.allCourses')}
      </button>

      <header className="card overflow-hidden">
        <div className="h-1.5" style={{ backgroundColor: color.solid }} />
        <div className="flex items-start gap-4 p-5">
          <LessonIcon icon={course.icon} level={level.id} size="lg" done={s.done === s.total} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: color.text }}>
              {t(`learn.levels.${level.id}.title`)}
            </div>
            <h1 className="text-xl font-bold tracking-tight">{tl(`courses.${course.id}.title`)}</h1>
            <p className="mt-1 text-sm text-chesscom-500">{tl(`courses.${course.id}.desc`)}</p>
            <div className="mt-3 flex items-center gap-3 text-xs text-chesscom-500">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700">
                <div className="h-full rounded-full" style={{ width: `${(s.done / s.total) * 100}%`, backgroundColor: color.solid }} />
              </div>
              <span className="font-mono tabular-nums">{s.done}/{s.total}</span>
              <span className="flex items-center gap-0.5 font-mono tabular-nums"><Star className="h-3 w-3 fill-gold-500 text-gold-600" /> {s.stars}/{s.maxStars}</span>
            </div>
          </div>
        </div>
      </header>

      <ol className="space-y-2">
        {course.lessons.map((lesson, i) => {
          const row = progress.get(lesson.id);
          const complete = !!row?.completed_at;
          const inProgress = !!row && row.step > 0;
          const isNext = lesson.id === nextId;
          const tasks = lesson.steps.filter((st) => st.type !== 'info').length;
          return (
            <motion.li
              key={lesson.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <button
                onClick={() => onOpen(lesson.id)}
                className={cn(
                  'card-hover flex w-full items-center gap-3 p-3 text-left sm:p-4',
                  isNext && 'ring-2 ring-gold-500/70',
                )}
              >
                <div className="relative">
                  <LessonIcon icon={lesson.icon} level={level.id} done={complete} />
                  {complete && (
                    <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white ring-2 ring-white dark:ring-chesscom-800">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-chesscom-400">{i + 1}</span>
                    <span className="truncate text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{tl(`${lesson.id}.title`)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-chesscom-500">{tl(`${lesson.id}.desc`)}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-chesscom-400">
                    <span>{t('learn.tasks', { count: tasks })}</span>
                    {inProgress && <span className="text-gold-700 dark:text-gold-300">· {t('learn.atStep', { n: Math.min(row!.step, lesson.steps.length - 1) + 1, total: lesson.steps.length })}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <div className="flex" role="img" aria-label={t('learn.starsEarned', { n: row?.stars ?? 0 })}>
                    {[1, 2, 3].map((n) => (
                      <Star key={n} className={cn('h-4 w-4', n <= (row?.stars ?? 0) ? 'fill-gold-500 text-gold-600' : 'text-chesscom-200 dark:text-chesscom-600')} />
                    ))}
                  </div>
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold',
                    isNext ? 'bg-green-500 text-white' : 'bg-chesscom-100 text-chesscom-700 dark:bg-chesscom-700 dark:text-chesscom-200',
                  )}>
                    {inProgress ? <Play className="h-3 w-3" /> : complete ? <RotateCcw className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    {inProgress ? t('learn.resume') : complete ? t('learn.repeat') : t('learn.start')}
                  </span>
                </div>
              </button>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
