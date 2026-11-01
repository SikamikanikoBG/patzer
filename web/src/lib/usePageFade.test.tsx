// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { usePageFade } from './usePageFade';

function Page({ path, animate }: { path: string; animate: () => void }) {
  const ref = usePageFade<HTMLDivElement>(path);
  return <div ref={(el) => { if (el) el.animate = animate as never; (ref as { current: HTMLDivElement | null }).current = el; }} />;
}

const setReducedMotion = (matches: boolean) => {
  window.matchMedia = vi.fn(() => ({ matches })) as never;
};

afterEach(cleanup);

describe('usePageFade', () => {
  it('fades once on opening and again only when the path changes', () => {
    setReducedMotion(false);
    const animate = vi.fn();
    const { rerender } = render(<Page path="/learn" animate={animate} />);
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<Page path="/learn" animate={animate} />);
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<Page path="/train" animate={animate} />);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('only changes opacity, so a board on the page never moves', () => {
    setReducedMotion(false);
    const animate = vi.fn();
    render(<Page path="/lab" animate={animate} />);
    const [frames] = animate.mock.calls[0] as unknown as [Record<string, unknown>[]];
    for (const frame of frames) expect(Object.keys(frame)).toEqual(['opacity']);
  });

  it('respects reduced motion', () => {
    setReducedMotion(true);
    const animate = vi.fn();
    render(<Page path="/learn" animate={animate} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
