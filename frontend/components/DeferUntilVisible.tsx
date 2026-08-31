'use client';
// Defers mounting a subtree until it is near the viewport.
//
// Several dashboard routes stack whole screens on top of each other, and every
// one fires its queries on mount — so opening /business-hub kicked off three
// screens' worth of heavy aggregates at once, competing for the same database
// even though only the first is above the fold. Mounting on approach keeps the
// first paint cheap without the user ever seeing a gap: rootMargin starts the
// fetch several hundred pixels before the section is reached.

import { useEffect, useRef, useState } from 'react';

export function DeferUntilVisible({
  children,
  minHeight = 320,
  rootMargin = '600px',
}: {
  children: React.ReactNode;
  /** Reserved height while deferred, so the scrollbar doesn't jump on mount. */
  minHeight?: number;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old browser, or a test environment):
    // render immediately rather than hiding content behind a missing API.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);

  return (
    <div ref={ref} style={shown ? undefined : { minHeight }}>
      {shown ? children : null}
    </div>
  );
}
