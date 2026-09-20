"use client";

import { listenForInstallPrompt } from "../lib/install-prompt";

// Attached as this module is first evaluated in the browser — on hydration of
// whichever page loads first, sign-in included — rather than in an effect,
// which would run later still.
if (typeof window !== "undefined") listenForInstallPrompt(window);

/**
 * Holds the browser's install offer on every page (ADR-0016), so it is still
 * there when the person reaches the console's "Install Rasi" option. Renders
 * nothing.
 */
export function InstallPromptListener() {
  return null;
}
