"use client";

import { useSyncExternalStore } from "react";

/**
 * The Junior's screens are views of one page, told apart by the URL hash
 * (decision 2026-09-14). The service worker caches pages by exact URL, so
 * separate `/route/collect/<id>` pages would not open offline for a customer
 * whose page was never visited with signal — a hash never reaches the network,
 * and every view is the one cached document, reloads included.
 *
 * Five are **tabs** on the bottom navigation, as in a native app (J-01, J-09,
 * J-03, J-05, J-08): `/route` the route, `#customers` the line's customer
 * portfolio, `#collections` today's collections,
 * `#handover` cash, `#profile` the Junior and this phone. The rest are
 * **screens opened over a tab**, each with a back arrow: `#collect/<id>`
 * (J-02), `#customer/<id>` (J-10, a customer's portfolio), `#sync` (J-04), `#correct` (J-06) and `#notifications` (J-07).
 * `#handover`, `#notifications` and `#correct` need signal.
 */
export type View =
  | { name: "route" }
  | { name: "customers" }
  | { name: "collections" }
  | { name: "handover" }
  | { name: "profile" }
  | { name: "collect"; customerId: string }
  | { name: "customer"; customerId: string }
  | { name: "sync" }
  | { name: "notifications" }
  | { name: "correct" };

export type Tab =
  "route" | "customers" | "collections" | "handover" | "profile";

const ROUTE: View = { name: "route" };

export function parseView(hash: string): View {
  const value = hash.replace(/^#/, "");
  if (value === "customers") return { name: "customers" };
  if (value === "collections") return { name: "collections" };
  if (value === "handover") return { name: "handover" };
  if (value === "profile") return { name: "profile" };
  if (value === "sync") return { name: "sync" };
  if (value === "notifications") return { name: "notifications" };
  if (value === "correct") return { name: "correct" };
  const collect = /^collect\/([\w-]+)$/.exec(value);
  if (collect) return { name: "collect", customerId: collect[1]! };
  const customer = /^customer\/([\w-]+)$/.exec(value);
  if (customer) return { name: "customer", customerId: customer[1]! };
  return ROUTE;
}

export function isTab(view: View): view is { name: Tab } {
  return (
    view.name === "route" ||
    view.name === "customers" ||
    view.name === "collections" ||
    view.name === "handover" ||
    view.name === "profile"
  );
}

export const TAB_HASH: Record<Tab, string> = {
  route: "",
  customers: "#customers",
  collections: "#collections",
  handover: "#handover",
  profile: "#profile",
};

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

let snapshot: { hash: string; view: View } = { hash: "", view: ROUTE };
function read(): View {
  const hash = window.location.hash;
  if (hash !== snapshot.hash) snapshot = { hash, view: parseView(hash) };
  return snapshot.view;
}

export function useView(): View {
  return useSyncExternalStore(subscribe, read, () => ROUTE);
}

/**
 * The hashes this page pushed, oldest first: the way back is to pop one.
 * Kept in the module rather than `history.state`, which Next owns. The phone's
 * own back button pops the browser's history; `track` notices when it lands on
 * a hash we pushed from, and drops it here too.
 */
const trail: string[] = [];

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const at = window.location.hash;
    if (trail.at(-1) === at) trail.pop();
    // Back on the route, nothing is under it.
    if (parseView(at).name === "route") trail.length = 0;
  });
}

function push(hash: string): void {
  trail.push(window.location.hash);
  window.location.hash = hash;
}

function replace(hash: string): void {
  if (hash === "") {
    // Back on the route: replace, keeping Next's history state.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.replace(hash);
}

/**
 * Opens a screen over the current one — a customer, Sync, a correction. The
 * phone's back button, and the screen's back arrow, return to where it was
 * opened from.
 */
export function openView(hash: `#${string}`): void {
  if (window.location.hash === hash) return;
  push(hash);
}

/**
 * Moves between tabs, as a native bottom bar does: from the route it pushes, so
 * back returns to the route; from another tab it replaces, so there is never
 * more than one step back to the route (navigation-ia.md).
 */
export function switchTab(tab: Tab): void {
  const hash = TAB_HASH[tab];
  if (window.location.hash === hash) return;
  const here = parseView(window.location.hash);
  if (here.name === "route") {
    push(hash);
    return;
  }
  if (tab === "route" && trail.length > 0) {
    trail.length = 0;
    window.history.go(-1);
    return;
  }
  replace(hash);
}

/** What the back arrow returns to, for its name ("Back to route"). */
export function backTarget(): Tab | null {
  const previous = parseView(trail.at(-1) ?? "");
  return isTab(previous) ? previous.name : null;
}

/** The back arrow: to the screen this one was opened from, else the route. */
export function goBack(): void {
  if (trail.length > 0) {
    trail.pop();
    window.history.back();
    return;
  }
  // Opened directly (a reload on #sync): replace with the route.
  replace("");
}

/** After the last account at a door is recorded (US-041): back to the route. */
export function backToRoute(): void {
  if (parseView(window.location.hash).name === "route") return;
  goBack();
}
