import { describe, expect, it } from "vitest";

import { contrastRatio, readColourTokens } from "./test/contrast";
import themeCss from "./theme.css?raw";

const tokens = readColourTokens(themeCss);

function token(name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`theme.css has no --color-${name}`);
  return value;
}

const TEXT = 4.5;
const NON_TEXT = 3;
const SURFACES = ["surface", "surface-raised", "surface-sunken"];
const TONES = ["positive", "warning", "critical", "info"];

/** [foreground, background, minimum] — every pairing a component draws. */
const PAIRS: [string, string, number][] = [
  ...SURFACES.flatMap((surface) =>
    ["ink", "ink-muted", "ink-subtle", "accent", ...TONES].map(
      (text): [string, string, number] => [text, surface, TEXT],
    ),
  ),
  // The sidebar's labels and section titles on its own layer.
  ...["ink", "ink-muted", "ink-subtle"].map(
    (text): [string, string, number] => [text, "surface-nav", TEXT],
  ),
  // The unread count on a nav item.
  ["ink-inverse", "critical", TEXT],
  ["accent-ink", "accent", TEXT],
  ["accent", "accent-subtle", TEXT],
  ["ink", "accent-subtle", TEXT],
  ["ink-inverse", "ink", TEXT],
  // Control outlines (WCAG 1.4.11).
  ["border-strong", "surface-raised", NON_TEXT],
  ...TONES.flatMap((tone): [string, string, number][] => [
    // Badge and message text on its tinted ground.
    [tone, `${tone}-subtle`, TEXT],
    ["ink", `${tone}-subtle`, TEXT],
    // A solid status fill with inverse text: the danger button, the unread count.
    ["ink-inverse", tone, TEXT],
    // A status dot with no text beside it carrying the meaning alone.
    [`${tone}-bright`, "surface-raised", NON_TEXT],
  ]),
];

describe("theme colour tokens", () => {
  it.each(PAIRS)("%s on %s reaches %s:1", (foreground, background, minimum) => {
    expect(
      contrastRatio(token(foreground), token(background)),
    ).toBeGreaterThanOrEqual(minimum);
  });

  it("declares every status role for every tone", () => {
    for (const tone of TONES) {
      for (const role of ["", "-subtle", "-border", "-bright"]) {
        expect(tokens.has(`${tone}${role}`), `--color-${tone}${role}`).toBe(
          true,
        );
      }
    }
  });

  it("uses no hex colours", () => {
    expect(themeCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("contrastRatio", () => {
  it("gives the known extremes", () => {
    expect(contrastRatio("oklch(0% 0 0)", "oklch(100% 0 0)")).toBeCloseTo(
      21,
      0,
    );
    expect(contrastRatio("oklch(100% 0 0)", "oklch(100% 0 0)")).toBe(1);
  });
});
