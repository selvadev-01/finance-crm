/**
 * Money strings → plot geometry, for `AreaChart` (ADR-0015).
 *
 * This is **the only place in the UI a money value meets a JS number**, and
 * only as a fraction of the plot's height — never as an amount (BR-11,
 * coding-guidelines non-negotiable 1). Parsing, the axis ceiling and the tick
 * values all stay in BigInt paise; labels are decimal strings for
 * `formatCurrency`.
 */

/** `"-12.5"` → `-1250n`. `@repo/ui` cannot import the app's `lib/money`, so it keeps its own. */
export function toPaise(value: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `toPaise expects a decimal string with at most two places, received ${JSON.stringify(value)}.`,
    );
  }
  const [, sign, rupees = "0", fraction = ""] = match;
  const paise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));
  return sign ? -paise : paise;
}

/** `125050n` → `"1250.50"`. */
export function fromPaise(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

const STEPS = [10n, 20n, 25n, 50n, 100n] as const;

/**
 * The smallest 1, 2, 2.5 or 5 × 10ⁿ rupees at or above `max` paise, so the
 * axis reads in round figures. Never below ₹1: an all-zero series still has
 * an axis to sit on.
 */
export function niceCeiling(max: bigint): bigint {
  if (max <= 100n) return 100n;
  // Scale so the leading step compares against 10…100 × 10ⁿ paise.
  let scale = 1n;
  while (max > 100n * scale) scale *= 10n;
  for (const step of STEPS) {
    if (step * scale >= max) return step * scale;
  }
  return 100n * scale;
}

/**
 * `value` as a share of `ceiling`, 0 … 1, to four places. A negative value — a
 * day of only downward corrections — is drawn at the baseline; the tooltip
 * still shows its signed figure.
 */
export function plotFraction(value: bigint, ceiling: bigint): number {
  if (ceiling <= 0n || value <= 0n) return 0;
  if (value >= ceiling) return 1;
  return Number((value * 10_000n) / ceiling) / 10_000;
}

/** Evenly spaced axis values from 0 to `ceiling`, as decimal strings. */
export function axisTicks(ceiling: bigint, count = 4): string[] {
  const steps = BigInt(count);
  return Array.from({ length: count + 1 }, (_, index) =>
    fromPaise((ceiling * BigInt(index)) / steps),
  );
}

export interface PlotPoint {
  x: number;
  y: number;
}

/**
 * A smooth path through the points that never overshoots between them
 * (Fritsch–Carlson monotone cubic), so a curve between two zero days stays on
 * the baseline instead of dipping below it.
 */
export function monotonePath(points: readonly PlotPoint[]): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  if (points.length === 1) return `M${round(first.x)},${round(first.y)}`;

  const n = points.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    slopes.push((b.y - a.y) / (b.x - a.x));
  }
  const tangents: number[] = [slopes[0]!];
  for (let i = 1; i < n - 1; i += 1) {
    const before = slopes[i - 1]!;
    const after = slopes[i]!;
    tangents.push(before * after <= 0 ? 0 : (before + after) / 2);
  }
  tangents.push(slopes[n - 2]!);
  for (let i = 0; i < n - 1; i += 1) {
    const slope = slopes[i]!;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = tangents[i]! / slope;
    const beta = tangents[i + 1]! / slope;
    const length = alpha * alpha + beta * beta;
    if (length > 9) {
      const tau = 3 / Math.sqrt(length);
      tangents[i] = tau * alpha * slope;
      tangents[i + 1] = tau * beta * slope;
    }
  }

  let path = `M${round(first.x)},${round(first.y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const third = (b.x - a.x) / 3;
    path +=
      ` C${round(a.x + third)},${round(a.y + tangents[i]! * third)}` +
      ` ${round(b.x - third)},${round(b.y - tangents[i + 1]! * third)}` +
      ` ${round(b.x)},${round(b.y)}`;
  }
  return path;
}

const round = (value: number) => Math.round(value * 100) / 100;
