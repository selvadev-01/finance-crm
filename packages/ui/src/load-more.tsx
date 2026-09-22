"use client";

import { useEffect, useRef } from "react";

/**
 * Loads the next piece of a long list as the reader nears its end: an
 * invisible marker after the last row that calls `onMore` once it is within
 * `ahead` of the viewport. The page is the one scroll container — the list
 * never gets a scroll box of its own — so the marker watches the viewport.
 *
 * It does nothing while `busy`, so a slow page is not asked for twice, and it
 * fires again only when it leaves view and comes back, or when `busy` clears
 * with it still in view (a short page that did not fill the screen).
 */
export function LoadMoreSentinel({
  onMore,
  busy = false,
  ahead = "600px",
}: {
  onMore: () => void;
  busy?: boolean;
  /** How far below the viewport to start loading (a CSS length). */
  ahead?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  useEffect(() => {
    latest.current = onMore;
  }, [onMore]);

  useEffect(() => {
    const node = ref.current;
    if (!node || busy || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: `0px 0px ${ahead} 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [busy, ahead]);

  return <div ref={ref} aria-hidden className="h-px w-full" />;
}
