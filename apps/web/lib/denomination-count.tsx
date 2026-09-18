"use client";

import { Minus, Plus } from "@phosphor-icons/react/dist/ssr";
import { DENOMINATIONS } from "@repo/contracts";
import { Button, cn, formatCurrency } from "@repo/ui";

export type Counts = Record<(typeof DENOMINATIONS)[number], number>;

export const emptyCounts = (): Counts =>
  Object.fromEntries(
    DENOMINATIONS.map((denomination) => [denomination, 0]),
  ) as Counts;

/**
 * Σ denomination × count as a rupee string. Notes and coins are whole rupees,
 * so the arithmetic is on BigInt — a total never passes through a JS number
 * (BR-11), and `formatCurrency` takes the string.
 */
export function countedTotal(counts: Counts): string {
  const total = DENOMINATIONS.reduce(
    (sum, denomination) =>
      sum + BigInt(denomination) * BigInt(counts[denomination]),
    0n,
  );
  return `${total}.00`;
}

/** `declared − system`, both rupee strings with two decimals, as a signed string. */
export function difference(declared: string, system: string): string {
  const paise = (value: string) => {
    const [whole = "0", fraction = "00"] = value.replace("-", "").split(".");
    const amount =
      BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
    return value.startsWith("-") ? -amount : amount;
  };
  const diff = paise(declared) - paise(system);
  const abs = diff < 0n ? -diff : diff;
  return `${diff < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/**
 * The nine counts of a handover (S-06), each with − and + for a thumb and a
 * number field for a pile of notes. The total is computed, never typed: the
 * count and the total cannot disagree.
 */
export function DenominationCount({
  counts,
  onChange,
  disabled = false,
}: {
  counts: Counts;
  onChange: (counts: Counts) => void;
  disabled?: boolean;
}) {
  const set = (denomination: (typeof DENOMINATIONS)[number], count: number) =>
    onChange({
      ...counts,
      [denomination]: Math.max(0, Math.min(100_000, count)),
    });

  return (
    <ul className="flex flex-col divide-y divide-border rounded-surface border border-border bg-surface-raised">
      {DENOMINATIONS.map((denomination) => {
        const count = counts[denomination];
        const label = `₹${denomination} ${denomination >= 10 ? "notes" : "coins"}`;
        return (
          <li
            key={denomination}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <span
              className="w-16 shrink-0 text-base font-semibold text-ink"
              data-numeric
            >
              ₹{denomination}
            </span>
            <span className="flex items-center gap-1">
              <Button
                tone="ghost"
                aria-label={`One fewer ${label}`}
                onClick={() => set(denomination, count - 1)}
                disabled={disabled || count === 0}
              >
                <Minus aria-hidden size={18} weight="bold" />
              </Button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                aria-label={`Number of ${label}`}
                value={count}
                disabled={disabled}
                onChange={(event) =>
                  set(
                    denomination,
                    Number.parseInt(event.target.value || "0", 10) || 0,
                  )
                }
                className={cn(
                  "h-[var(--control-height)] w-16 rounded-control border border-border-strong bg-surface-raised text-center text-base text-ink",
                  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
                )}
                data-numeric
              />
              <Button
                tone="ghost"
                aria-label={`One more ${label}`}
                onClick={() => set(denomination, count + 1)}
                disabled={disabled}
              >
                <Plus aria-hidden size={18} weight="bold" />
              </Button>
            </span>
            <span
              className="w-24 shrink-0 text-right text-sm text-ink-muted"
              data-numeric
            >
              {formatCurrency(`${BigInt(denomination) * BigInt(count)}.00`)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Counts as the API takes them: only non-zero rows. */
export const countsBody = (counts: Counts) =>
  DENOMINATIONS.filter((denomination) => counts[denomination] > 0).map(
    (denomination) => ({
      denomination,
      count: counts[denomination],
    }),
  );
