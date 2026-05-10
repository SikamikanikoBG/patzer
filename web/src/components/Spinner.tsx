import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
  className?: string;
}

export default function Spinner({ label, size = 'sm', inline = false, className }: Props) {
  const sizeCls = size === 'sm' ? 'h-4 w-4' : size === 'md' ? 'h-5 w-5' : 'h-6 w-6';
  return (
    <span className={cn(inline ? 'inline-flex' : 'flex', 'items-center gap-2 text-ink-500', className)}>
      <Loader2 className={cn(sizeCls, 'animate-spin text-accent-500')} />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}

// Three-dot pulsing indicator for "AI is thinking" type states.
export function ThinkingDots({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-500">
      <span className="inline-flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" style={{ animationDelay: '300ms' }} />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}
