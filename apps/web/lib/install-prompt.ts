import { useSyncExternalStore } from "react";

/**
 * The browser's offer to install Rasi (Chromium's `beforeinstallprompt`).
 * It is held back, so Rasi can ask which layout this device should show first
 * and then open the browser's own install dialog (ADR-0016). Browsers without
 * the event — Safari, Firefox — install from their own menu; the installed app
 * then asks on its first launch instead.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

// The event can fire as soon as the page loads, before any screen mounts, so
// it is caught when this module is first evaluated in the browser.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the browser will install Rasi on request. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
}

/** Opens the browser's install dialog. The offer can be used once. */
export async function install(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const offer = deferred;
  if (!offer) return "unavailable";
  deferred = null;
  notify();
  await offer.prompt();
  const { outcome } = await offer.userChoice;
  return outcome;
}
