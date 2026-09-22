"use client";

import { LoadMoreSentinel } from "@repo/ui";
import { type ReactNode, useState } from "react";

/** Rows a long list shows at first, and adds each time its end comes near. */
export const LAZY_STEP = 20;

/**
 * A long list on the phone, drawn a piece at a time as the Junior scrolls
 * (2026-09-22): a line of 100 customers renders 20 cards, then 20 more as the
 * end comes near, in the one page scroll — never a scroll box of its own.
 * The data is already on the phone; this only spares drawing it all at once.
 *
 * `resetKey` is whatever reshapes the list (a filter, a search): a new one
 * starts again from the top piece, derived during render rather than in an
 * effect, so the first paint of a new filter is already short.
 */
export function useLazyCount(
  total: number,
  resetKey: string,
): { count: number; more: ReactNode } {
  const [state, setState] = useState({ key: resetKey, count: LAZY_STEP });
  const count = state.key === resetKey ? state.count : LAZY_STEP;
  if (state.key !== resetKey) setState({ key: resetKey, count: LAZY_STEP });

  const more =
    count < total ? (
      <>
        <LoadMoreSentinel
          onMore={() =>
            setState((previous) => ({
              key: resetKey,
              count:
                (previous.key === resetKey ? previous.count : LAZY_STEP) +
                LAZY_STEP,
            }))
          }
        />
        <p className="px-1 text-center text-xs text-ink-muted" data-numeric>
          Showing {count} of {total}
        </p>
      </>
    ) : null;

  return { count: Math.min(count, total), more };
}
