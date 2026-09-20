import { useSyncExternalStore } from "react";

/**
 * The browser's offer to install Rasi (Chromium's `beforeinstallprompt`).
 * It is held back, so Rasi can ask which layout this device should show first
 * and then open the browser's own install dialog (ADR-0016). Browsers without
 * the event — Safari, Firefox — install from their own menu; the installed app
 * then asks on its first launch instead.
 *
 * The listener is attached by `app/install-prompt-listener.tsx`, from the root
 * layout, on every page: the event fires once per page load, usually on the
 * first page — the sign-in screen — and signing in moves to the console
 * without a reload, so a listener that arrived with the console would miss it.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let listening = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Starts holding the browser's offer. On the Junior's field app (`/route`) the
 * offer is left alone: that app has no account menu to install from, so the
 * browser's own install banner is the way in.
 */
export function listenForInstallPrompt(target: Window): void {
  if (listening) return;
  listening = true;
  target.addEventListener("beforeinstallprompt", (event) => {
    if (target.location.pathname.startsWith("/route")) return;
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  target.addEventListener("appinstalled", () => {
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
export function canInstall(): boolean {
  return deferred !== null;
}

export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribe, canInstall, () => false);
}

/**
 * Opens the browser's install dialog. Call it from the click that asked for
 * it: the browser allows the dialog only during a user gesture. The offer can
 * be used once.
 */
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
