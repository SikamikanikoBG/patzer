// Learn section (roadmap #7) — progress per profile and lesson. The lesson
// content lives in the web app; the server stores where you are and how well
// you did, and nothing else. One table: learn_progress (see db.ts).

import { db } from './db.js';

export interface LessonProgress {
  lesson_id: string;
  step: number;
  flawed: number;
  stars: number;
  completed_at: string | null;
  updated_at: string;
}

/** Lesson ids are content-file keys: lowercase words joined by dashes. */
export const LESSON_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_STEPS = 60;
/** Far more lessons than there are; stops a script from filling the disk
 *  with made-up lesson ids. */
export const MAX_LESSONS_PER_USER = 500;

/** False when this would be a new row and the user already has the most. */
export function hasRoomFor(userId: number, lessonId: string): boolean {
  if (getProgress(userId, lessonId)) return true;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM learn_progress WHERE user_id = ?').get(userId) as { n: number };
  return n < MAX_LESSONS_PER_USER;
}

export function listProgress(userId: number): LessonProgress[] {
  return db.prepare(`
    SELECT lesson_id, step, flawed, stars, completed_at, updated_at
    FROM learn_progress WHERE user_id = ?
    ORDER BY updated_at DESC, lesson_id
  `).all(userId) as LessonProgress[];
}

/** Where you are in a lesson you haven't finished yet. */
export function saveStep(userId: number, lessonId: string, step: number, flawed: number): LessonProgress {
  db.prepare(`
    INSERT INTO learn_progress (user_id, lesson_id, step, flawed, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, lesson_id) DO UPDATE SET
      step = excluded.step, flawed = excluded.flawed, updated_at = excluded.updated_at
  `).run(userId, lessonId, step, flawed);
  return getProgress(userId, lessonId)!;
}

/** A finished lesson: keep the best result, remember when it was first done,
 *  and start the next run from the top. */
export function saveFinished(userId: number, lessonId: string, stars: number): LessonProgress {
  db.prepare(`
    INSERT INTO learn_progress (user_id, lesson_id, step, flawed, stars, completed_at, updated_at)
    VALUES (?, ?, 0, 0, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, lesson_id) DO UPDATE SET
      step = 0, flawed = 0,
      stars = MAX(learn_progress.stars, excluded.stars),
      completed_at = COALESCE(learn_progress.completed_at, excluded.completed_at),
      updated_at = excluded.updated_at
  `).run(userId, lessonId, stars);
  return getProgress(userId, lessonId)!;
}

function getProgress(userId: number, lessonId: string): LessonProgress | null {
  return (db.prepare(`
    SELECT lesson_id, step, flawed, stars, completed_at, updated_at
    FROM learn_progress WHERE user_id = ? AND lesson_id = ?
  `).get(userId, lessonId) as LessonProgress | undefined) ?? null;
}

/** For the achievements: finished lessons and stars held. */
export function learnTotals(userId: number): { lessons: number; stars: number } {
  const row = db.prepare(`
    SELECT COUNT(*) AS lessons, COALESCE(SUM(stars), 0) AS stars
    FROM learn_progress WHERE user_id = ? AND completed_at IS NOT NULL
  `).get(userId) as { lessons: number; stars: number };
  return { lessons: row.lessons, stars: row.stars };
}
