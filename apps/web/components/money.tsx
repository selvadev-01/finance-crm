import { cn, formatCurrency } from "@repo/ui";

import { absMoney, isNegativeMoney, isZeroMoney } from "../lib/money";

/**
 * A rupee amount in tabular figures. `formatCurrency` does the grouping; this
 * only makes sure a column of amounts lines up.
 */
export function Money({
  amount,
  className,
}: {
  amount: string;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums", className)} data-numeric>
      {formatCurrency(amount)}
    </span>
  );
}

/**
 * A signed change — a correction reads `−₹20.00` or `+₹20.00`. The minus is a
 * true minus sign (U+2212), which lines up with the plus.
 */
export function signedCurrency(amount: string): string {
  if (isZeroMoney(amount)) return formatCurrency("0.00");
  return `${isNegativeMoney(amount) ? "−" : "+"}${formatCurrency(absMoney(amount))}`;
}

/**
 * A cash difference, `declared − recorded`: "Matches", "−₹20.00 short" or
 * "+₹20.00 over". Short is critical — money did not arrive; over is not a
 * status, so it stays in ink (US-065).
 */
export function Discrepancy({ amount }: { amount: string }) {
  if (isZeroMoney(amount))
    return <span className="text-positive">Matches</span>;
  return isNegativeMoney(amount) ? (
    <span className="font-medium text-critical" data-numeric>
      −{formatCurrency(absMoney(amount))} short
    </span>
  ) : (
    <span className="font-medium text-ink" data-numeric>
      +{formatCurrency(amount)} over
    </span>
  );
}
