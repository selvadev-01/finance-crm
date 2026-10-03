import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TOURS, tourFor } from "./tours";

const APP = fileURLToPath(new URL("../../app", import.meta.url));

/** Every screen's path, as its tour names it: route groups dropped. */
function screens(directory = APP): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return screens(path);
    if (name !== "page.tsx") return [];
    const parts = relative(APP, directory)
      .split(sep)
      .filter((part) => part && !/^\(.+\)$/.test(part));
    return [`/${parts.join("/")}`];
  });
}

/**
 * Pages that only send the reader somewhere else, are for developers, or are
 * the sign-in and password screens, which have no tour by decision.
 */
const NOT_SCREENS = new Set([
  "/",
  "/home",
  "/settings",
  "/design-system",
  "/sign-in",
  "/[slug]/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/change-password",
]);

describe("tours", () => {
  it("has a tour for every screen", () => {
    const toured = new Set(TOURS.map((tour) => tour.path));
    const found = screens();
    expect(found.length).toBeGreaterThan(50);
    const missing = found.filter(
      (path) => !NOT_SCREENS.has(path) && !toured.has(path),
    );
    expect(missing).toEqual([]);
  });

  it("says every step in both English and Tanglish", () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        for (const said of [step.title, step.body]) {
          expect(said.en.trim(), tour.path).not.toBe("");
          expect(said.ta.trim(), tour.path).not.toBe("");
        }
      }
    }
  });

  it("keeps document IDs out of what people read", () => {
    const ids = /\b(US|ADR|BR|S|J|M)-\d/;
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        const text = [step.title.en, step.title.ta, step.body.en, step.body.ta];
        for (const line of text) expect(line, tour.path).not.toMatch(ids);
      }
    }
  });

  it("prefers a fixed segment over a parameter", () => {
    expect(tourFor("/customers/new", "").path).toBe("/customers/new");
    expect(tourFor("/customers/c-123", "").path).toBe(
      "/customers/[customerId]",
    );
    expect(tourFor("/customers/c-123/edit/", "").path).toBe(
      "/customers/[customerId]/edit",
    );
  });

  it("gives each field app view its own tour", () => {
    for (const view of [
      "customers",
      "collections",
      "handover",
      "profile",
      "sync",
      "notifications",
      "correct",
      "expense",
    ]) {
      expect(tourFor("/route", `#${view}`).hash).toBe(view);
    }
    expect(tourFor("/route", "#collect/c-1").hash).toBe("collect/");
    expect(tourFor("/route", "#customer/c-1").hash).toBe("customer/");
    expect(tourFor("/route", "").hash).toBeUndefined();
    expect(tourFor("/route", "#todays-route").hash).toBeUndefined();
  });

  it("falls back to a general tour on a screen it does not know", () => {
    expect(tourFor("/somewhere/new", "").path).toBe("*");
  });
});
