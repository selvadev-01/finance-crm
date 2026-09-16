"use client";

import { notificationContract } from "@repo/contracts";
import { useEffect, useState } from "react";

import { api } from "../api-client";

/** How often the bell asks; push, when on, is the fast path (US-071). */
const POLL_MS = 60_000;

/** Tell the bell to re-read at once, e.g. after marking notifications read. */
export const UNREAD_CHANGED = "rasi:unread-changed";

/**
 * The signed-in user's unread count for the bell (US-070): read on mount, every
 * minute while the tab is visible, when the tab comes back, and when a screen
 * announces a change. `null` until known or while Rasi is unreachable, so the
 * bell never shows a stale number as fact.
 */
export function useUnreadCount(enabled = true): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const read = () => {
      if (document.visibilityState !== "visible") return;
      api(notificationContract.listNotifications, {
        query: { limit: 1, unread: "true" },
      })
        .then((result) => {
          if (!cancelled) setCount(result.ok ? result.body.unreadCount : null);
        })
        .catch(() => {
          if (!cancelled) setCount(null);
        });
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    document.addEventListener("visibilitychange", read);
    window.addEventListener(UNREAD_CHANGED, read);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener(UNREAD_CHANGED, read);
    };
  }, [enabled]);

  return count;
}

export function announceUnreadChanged(): void {
  window.dispatchEvent(new Event(UNREAD_CHANGED));
}
