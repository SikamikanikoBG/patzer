import { useLayoutEffect, useRef } from 'react';

// Fades the page in whenever the route changes, on the same timing as the Learn
// page's opening. Only opacity: moving the page would leave a board's cached
// position wrong once it settled, and clicks would land on the wrong square. The
// Web Animations API rather than a keyed wrapper, because a key would remount the
// page when only a route parameter changes, losing its state.
export function usePageFade<T extends HTMLElement>(pathname: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ref.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' });
  }, [pathname]);
  return ref;
}
