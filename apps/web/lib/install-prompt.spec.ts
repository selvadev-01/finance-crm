import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BeforeInstallPromptEvent } from "./install-prompt";

type Module = typeof import("./install-prompt");

/** A page at `pathname` that can receive the browser's install events. */
function page(pathname: string) {
  return Object.assign(new EventTarget(), {
    location: { pathname },
  }) as EventTarget & { location: { pathname: string } };
}

/** The browser's offer, answered with `outcome` when the dialog is shown. */
function offer(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as BeforeInstallPromptEvent;
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { event, prompt };
}

let install: Module;

beforeEach(async () => {
  // Module state — the held offer — starts empty for every test.
  vi.resetModules();
  install = await import("./install-prompt");
});

describe("holding the browser's install offer", () => {
  it("holds the offer so Rasi can ask about the layout first, then installs once", async () => {
    const target = page("/sign-in");
    install.listenForInstallPrompt(target as unknown as Window);
    expect(await install.install()).toBe("unavailable");

    const { event, prompt } = offer("accepted");
    target.dispatchEvent(event);
    // Held back: the browser does not show its own banner.
    expect(event.defaultPrevented).toBe(true);
    expect(install.canInstall()).toBe(true);

    expect(await install.install()).toBe("accepted");
    expect(prompt).toHaveBeenCalledOnce();
    // The browser's offer can be used once.
    expect(install.canInstall()).toBe(false);
    expect(await install.install()).toBe("unavailable");
  });

  it("lets the Junior's field app keep the browser's own banner", () => {
    const target = page("/route");
    install.listenForInstallPrompt(target as unknown as Window);
    const { event } = offer();
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(install.canInstall()).toBe(false);
  });

  it("forgets the offer once Rasi is installed another way", () => {
    const target = page("/dashboard");
    install.listenForInstallPrompt(target as unknown as Window);
    target.dispatchEvent(offer().event);
    expect(install.canInstall()).toBe(true);
    target.dispatchEvent(new Event("appinstalled"));
    expect(install.canInstall()).toBe(false);
  });
});
