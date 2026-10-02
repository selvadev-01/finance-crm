"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * How many screen reads are in flight right now, for the console's activity
 * bar. `useApiQuery` reports each read it starts; nothing else does, so a
 * background poll (the bell's unread count) never flashes the bar.
 */
let inFlight = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Count one read as started; call the returned function when it settles. */
export function trackRead(): () => void {
  inFlight += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight -= 1;
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether any read has been in flight for longer than `delay` ms. The delay
 * keeps a fast answer from blinking the bar on and straight off again.
 */
export function useReadInFlight(delay = 150): boolean {
  const busy = useSyncExternalStore(
    subscribe,
    () => inFlight > 0,
    () => false,
  );
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [busy, delay]);

  return busy && shown;
}
