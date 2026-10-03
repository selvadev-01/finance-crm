import { useSyncExternalStore } from "react";

/**
 * The tour speaks English or Tanglish — Tamil as a coworker would type it,
 * in English letters with the English words people actually use at work.
 * Remembered per browser; storage can be missing or throw (a private
 * window), and the choice then lives in memory for the page's life.
 */
export type TourLanguage = "en" | "tanglish";

const KEY = "rasi.tour.language";
let remembered: TourLanguage | null = null;
const listeners = new Set<() => void>();

function read(): TourLanguage {
  if (remembered) return remembered;
  try {
    return window.localStorage.getItem(KEY) === "tanglish" ? "tanglish" : "en";
  } catch {
    return "en";
  }
}

function write(language: TourLanguage) {
  remembered = language;
  try {
    window.localStorage.setItem(KEY, language);
  } catch {
    // Kept in memory.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTourLanguage() {
  const language = useSyncExternalStore(
    subscribe,
    read,
    (): TourLanguage => "en",
  );
  return [language, write] as const;
}
