import { AT, type ScreenTour, step } from "./content";
import { BOOKS_TOURS } from "./tours/books";
import { FIELD_TOURS } from "./tours/field";
import { OPERATE_TOURS } from "./tours/operate";
import { RECORDS_TOURS } from "./tours/records";
import { REPORTS_TOURS } from "./tours/reports";
import { SETTINGS_TOURS } from "./tours/settings";

export type { ScreenTour } from "./content";

/**
 * The signed-in screens. The sign-in and password screens have no tour, by
 * the user's decision (2026-10-03): there is one thing to do there.
 */
export const TOURS: readonly ScreenTour[] = [
  ...OPERATE_TOURS,
  ...RECORDS_TOURS,
  ...REPORTS_TOURS,
  ...BOOKS_TOURS,
  ...SETTINGS_TOURS,
  ...FIELD_TOURS,
];

/** For a screen with no tour of its own: the page and the frame around it. */
const FALLBACK: ScreenTour = {
  path: "*",
  steps: [
    step(
      AT.header,
      ["This screen", "Indha screen"],
      [
        "The title says where you are, and the line under it says what this page is for.",
        "Mela irukka title-la neenga endha page-la irukeenga nu theriyum. Keezha irukka line indha page edhukku nu sollum.",
      ],
    ),
    step(
      AT.actions,
      ["What you can do here", "Inga enna panna mudiyum"],
      [
        "The buttons for this page sit here. You only see the ones your role is allowed to use.",
        "Indha page-oda buttons ellam inga dhaan irukkum. Unga role-ku allowed aana buttons mattum dhaan kaatum.",
      ],
    ),
    step(
      AT.tour,
      ["Tour any time", "Eppo venumnaalum tour"],
      [
        "Press this on any screen for its own tour, in English or Tanglish.",
        "Endha screen-la venumnaalum idha press pannunga — andha screen-oda tour varum, English-laiyo Tanglish-laiyo.",
      ],
    ),
  ],
};

/**
 * The tour for a path (and, in the field app, its hash view). A pattern's
 * `[param]` matches any one segment; where two match, the one with more fixed
 * segments wins, so `/customers/new` beats `/customers/[customerId]`.
 */
export function tourFor(pathname: string, hash: string): ScreenTour {
  const path = trimSlash(pathname);
  const view = hash.replace(/^#/, "");
  let best: { tour: ScreenTour; score: number } | null = null;
  for (const tour of TOURS) {
    const score = matchScore(tour.path, path);
    if (score === null) continue;
    if (tour.hash !== undefined && !hashMatches(tour.hash, view)) continue;
    // A tour for this exact view beats the page's general one.
    const total = score + (tour.hash ? 100 : 0);
    if (!best || total > best.score) best = { tour, score: total };
  }
  return best?.tour ?? FALLBACK;
}

function trimSlash(path: string) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function matchScore(pattern: string, path: string): number | null {
  const want = pattern.split("/");
  const have = path.split("/");
  if (want.length !== have.length) return null;
  let score = 0;
  for (const [index, part] of want.entries()) {
    if (part.startsWith("[") && part.endsWith("]")) continue;
    if (part !== have[index]) return null;
    score += 1;
  }
  return score;
}

/** `collect/` matches `collect/<customerId>`; an empty hash is the home view. */
function hashMatches(pattern: string, view: string) {
  if (pattern === "") return view === "";
  return pattern.endsWith("/") ? view.startsWith(pattern) : view === pattern;
}
