import { useSyncExternalStore } from "react";

/**
 * Which console layout this device shows (ADR-0016): the phone layout — an app
 * bar and a bottom tab bar — or the computer layout, the sidebar console. It is
 * chosen per device, not per person: a Senior's phone and their laptop each
 * keep their own answer. The Junior's route is phone-only and never asks.
 *
 * Kept in browser storage, like the sidebar's mode. Storage can be missing or
 * throw (a private window, blocked site data); the choice then lives in memory
 * for the page's life, and the installed app asks again next launch.
 */
export type DeviceLayout = "mobile" | "desktop";

export const LAYOUT_KEY = "rasi.device.layout";

export function parseLayout(value: unknown): DeviceLayout | null {
  return value === "mobile" || value === "desktop" ? value : null;
}

/**
 * What the console does with the saved choice:
 * - a choice was made → use it, wherever the app is running;
 * - none, in the installed app → ask before showing the console, which is how
 *   installing Rasi comes to begin with the question;
 * - none, in a browser tab → the computer layout, which already folds to a
 *   drawer on a narrow screen. A tab is not asked, so opening a link is never
 *   interrupted.
 */
export type LayoutDecision =
  { kind: "use"; layout: DeviceLayout } | { kind: "ask" };

export function decideLayout(
  saved: DeviceLayout | null,
  installed: boolean,
): LayoutDecision {
  if (saved) return { kind: "use", layout: saved };
  if (installed) return { kind: "ask" };
  return { kind: "use", layout: "desktop" };
}

/** The option the chooser marks as suggested: a small touch screen is a phone. */
export function suggestLayout(screen: {
  narrow: boolean;
  touch: boolean;
}): DeviceLayout {
  return screen.narrow && screen.touch ? "mobile" : "desktop";
}

/* -------------------------------------------------------------------------
 * The store.
 * ---------------------------------------------------------------------- */

let remembered: DeviceLayout | null = null;
const listeners = new Set<() => void>();

function readSaved(): DeviceLayout | null {
  if (remembered) return remembered;
  try {
    return parseLayout(window.localStorage.getItem(LAYOUT_KEY));
  } catch {
    return null;
  }
}

export function saveLayout(layout: DeviceLayout): void {
  remembered = layout;
  try {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // Kept in memory for this page's life.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key !== LAYOUT_KEY) return;
    remembered = null;
    listener();
  };
  window.addEventListener("storage", fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromOtherTab);
  };
}

/** The saved choice, or `null` before one is made. */
export function useSavedLayout(): DeviceLayout | null {
  return useSyncExternalStore(subscribe, readSaved, () => null);
}

/* -------------------------------------------------------------------------
 * Whether Rasi is running as the installed app rather than in a browser tab.
 * ---------------------------------------------------------------------- */

const STANDALONE = "(display-mode: standalone)";

function readInstalled(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean })
    .standalone;
  return window.matchMedia(STANDALONE).matches || iosStandalone === true;
}

function subscribeInstalled(listener: () => void) {
  const query = window.matchMedia(STANDALONE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function useInstalled(): boolean {
  return useSyncExternalStore(subscribeInstalled, readInstalled, () => false);
}

/** The chooser's suggestion for this screen. */
export function suggestForThisScreen(): DeviceLayout {
  return suggestLayout({
    narrow: window.matchMedia("(max-width: 767px)").matches,
    touch: window.matchMedia("(pointer: coarse)").matches,
  });
}
