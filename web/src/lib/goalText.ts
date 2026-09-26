import type { TFunction } from 'i18next';

// Plan goals are stored server-side with an English title/description, but
// every goal also carries its `kind`, `target` and `metadata` — enough to
// render the text in the user's language. Unknown kinds (or a missing
// translation) fall back to the stored English text.
interface GoalLike {
  kind: string;
  title: string;
  description: string;
  target: number;
  metadata: Record<string, unknown> | null;
}

export function goalText(t: TFunction, goal: GoalLike): { title: string; description: string } {
  const meta = goal.metadata ?? {};
  const color = meta.color === 'white' || meta.color === 'black' ? t(`play.${meta.color}`) : '';
  const vars = {
    target: goal.target,
    name: String(meta.opening_name ?? meta.eco ?? ''),
    color,
    minAccuracy: Number(meta.min_accuracy ?? 75),
  };
  return {
    title: t(`plan.goal.${goal.kind}.title`, { ...vars, defaultValue: goal.title }),
    description: t(`plan.goal.${goal.kind}.description`, { ...vars, defaultValue: goal.description }),
  };
}
