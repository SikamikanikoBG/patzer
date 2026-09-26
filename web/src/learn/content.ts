// Loads the Learn section's content on demand: four level files plus the
// lesson texts, which ride i18next as their own "learn" namespace. Kept out
// of the main bundle — most visits to Patzer never open a lesson.

import type { Language } from '../lib/languages';
import type { CourseDef, LessonDef, LevelDef, LevelId } from './types';

export interface LessonRef {
  lesson: LessonDef;
  course: CourseDef;
  level: LevelDef;
  /** Position in the whole curriculum, which is also the suggested order. */
  order: number;
}

export interface Curriculum {
  levels: LevelDef[];
  lessons: LessonRef[];
  byId: Map<string, LessonRef>;
  courseById: Map<string, { course: CourseDef; level: LevelDef }>;
}

export const LEVEL_IDS: readonly LevelId[] = ['basics', 'beginner', 'intermediate', 'advanced'];

export function buildCurriculum(levels: LevelDef[]): Curriculum {
  const lessons: LessonRef[] = [];
  const courseById = new Map<string, { course: CourseDef; level: LevelDef }>();
  for (const level of levels) {
    for (const course of level.courses) {
      courseById.set(course.id, { course, level });
      for (const lesson of course.lessons) lessons.push({ lesson, course, level, order: lessons.length });
    }
  }
  return { levels, lessons, byId: new Map(lessons.map((r) => [r.lesson.id, r])), courseById };
}

let curriculum: Promise<Curriculum> | null = null;

export function loadCurriculum(): Promise<Curriculum> {
  curriculum ??= Promise.all([
    import('./content/basics.json'),
    import('./content/beginner.json'),
    import('./content/intermediate.json'),
    import('./content/advanced.json'),
  ]).then((mods) => buildCurriculum(mods.map((m) => m.default as unknown as LevelDef)));
  return curriculum;
}

// Lesson texts per language. A language without its own file reads English
// (i18next's fallback) — German follows in its own pull request.
const TEXTS: Partial<Record<Language, () => Promise<{ default: unknown }>>> = {
  en: () => import('../locales/learn/en.json'),
};

const loadedTexts = new Map<Language, Promise<void>>();

export function loadLearnTexts(lang: Language): Promise<void> {
  const wanted: Language[] = lang === 'en' ? ['en'] : ['en', lang];
  return Promise.all(wanted.map((l) => {
    const loader = TEXTS[l];
    if (!loader) return Promise.resolve();
    let p = loadedTexts.get(l);
    if (!p) {
      // i18n is imported here, not at the top, so content.test.ts can use
      // buildCurriculum without starting i18next.
      p = Promise.all([loader(), import('../i18n')]).then(([m, { default: i18n }]) => {
        i18n.addResourceBundle(l, 'learn', m.default as object, true, true);
      });
      loadedTexts.set(l, p);
    }
    return p;
  })).then(() => undefined);
}
