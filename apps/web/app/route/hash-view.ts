"use client";

import { useSyncExternalStore } from "react";

/**
 * The Junior's screens are views of one page, told apart by the URL hash
 * (decision 2026-09-14): `/route` is S-01, `/route#collect/<customerId>` S-02,
 * `/route#sync` S-03, `/route#handover` S-06 (which needs signal), and
 * `/route#notifications` S-21 and `/route#correct` US-044 (which need signal
 * too). The
 * service worker caches pages by exact URL, so separate `/route/collect/<id>`
 * pages would not open offline for a customer whose page was never visited
 * with signal — a hash never reaches the network, and every view is the one
 * cached document, reloads included.
 */
export type View =
  | { name: "route" }
  | { name: "collect"; customerId: string }
  | { name: "sync" }
  | { name: "handover" }
  | { name: "notifications" }
  | { name: "correct" };

const ROUTE: View = { name: "route" };

export function parseView(hash: string): View {
  const value = hash.replace(/^#/, "");
  if (value === "sync") return { name: "sync" };
  if (value === "handover") return { name: "handover" };
  if (value === "notifications") return { name: "notifications" };
  if (value === "correct") return { name: "correct" };
  const collect = /^collect\/([\w-]+)$/.exec(value);
  if (collect) return { name: "collect", customerId: collect[1]! };
  return ROUTE;
}

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
 * Whether the current view was pushed on top of the route by `openView`, so
 * "back" can pop it rather than add another history entry.
 */
let pushedOverRoute = false;

/**
 * Opens a view. From the route it pushes, so the phone's back button returns to
 * the route; from another view it replaces, so there is never more than one
 * step back to the route (navigation-ia.md: back always goes to the route).
 */
export function openView(hash: `#${string}`): void {
  if (parseView(window.location.hash).name === "route") {
    pushedOverRoute = true;
    window.location.hash = hash;
  } else {
    window.location.replace(hash);
  }
}

export function backToRoute(): void {
  if (pushedOverRoute) {
    pushedOverRoute = false;
    window.history.back();
    return;
  }
  // Opened directly (a reload on #sync): replace, keeping Next's history state.
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
