/**
 * WCAG 2.x contrast for `oklch()` tokens, so `theme.test.ts` can hold the
 * palette to AA without a colour library. OKLCH → OKLab → linear sRGB
 * (Björn Ottosson's matrices), clamped to the sRGB gamut the way a browser
 * would render it, then relative luminance.
 */
const OKLCH = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/;

function relativeLuminance(token: string): number {
  const match = OKLCH.exec(token);
  if (!match) throw new Error(`Not an opaque oklch() colour: ${token}`);
  const l = Number(match[1]) / 100;
  const c = Number(match[2]);
  const h = (Number(match[3]) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const red = clamp(
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
  );
  const green = clamp(
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
  );
  const blue = clamp(
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Every `--color-*: oklch(...)` declared in a stylesheet, by name. */
export function readColourTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z-]+):\s*(oklch\([^)]*\))/g)) {
    tokens.set(match[1] as string, match[2] as string);
  }
  return tokens;
}
