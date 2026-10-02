import {
  ArrowsLeftRight,
  CalendarX,
  CaretRight,
  HandCoins,
  Receipt,
  SealCheck,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { AttentionItem, TrendPoint } from "@repo/contracts";
import { Card, cn, CodeChip, formatBusinessDate, FormMessage } from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  compareMoney,
  formatCompactCurrency,
  formatPerMille,
  isNegativeMoney,
  isZeroMoney,
  perMille,
} from "../../../lib/money";
import { signedAmount } from "../books/visuals";

/**
 * The visual parts the three dashboards share since the 2026-10-02 redesign
 * (Stitch "Super Admin Dashboard (Compact)", "Today's operations" and the
 * Senior line dashboard): the teal hero's figures, the KPI card, the ring,
 * the sparkline and the action list. Colour, type and radius come from the
 * `@theme` tokens only.
 */

export type Icon = typeof Receipt;

export type KpiTone = "accent" | "positive" | "warning" | "critical" | "info";

export const KPI_ICON: Record<KpiTone, string> = {
  accent: "bg-accent-subtle text-accent",
  positive: "bg-positive-subtle text-positive",
  warning: "bg-warning-subtle text-warning",
  critical: "bg-critical-subtle text-critical",
  info: "bg-info-subtle text-info",
};

const KPI_HINT: Record<KpiTone, string> = {
  accent: "text-ink-muted",
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  info: "text-info",
};

/** A headline figure in a card: label, value, icon tile, and a hint under a rule. */
export function KpiCard({
  label,
  icon: Glyph,
  tone,
  value,
  hint,
  href,
  aside,
}: {
  label: string;
  icon: Icon;
  tone: KpiTone;
  value: ReactNode;
  hint: ReactNode;
  /** Where the figure is explained; absent, the card is not a link. */
  href?: string;
  aside?: ReactNode;
}) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
            {label}
          </span>
          <span className="text-title text-ink" data-numeric>
            {value}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-control",
            KPI_ICON[tone],
          )}
        >
          <Glyph size={18} weight="regular" />
        </span>
      </span>
      <span className="flex items-end justify-between gap-3 border-t border-border pt-2">
        <span className={cn("text-caption", KPI_HINT[tone])}>{hint}</span>
        {aside}
      </span>
    </>
  );
  const frame =
    "flex min-w-0 flex-col gap-3 rounded-tile border border-border bg-surface-raised p-4";
  return href ? (
    <Link
      href={href}
      className={cn(frame, "transition-colors hover:border-accent")}
    >
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}

/**
 * The last working days' collections as a line, each day's height a share of
 * the busiest day — computed in exact paise (`perMille`), never as a number
 * of rupees. Decorative: the trend card carries the figures.
 */
export function Sparkline({
  points,
  className,
}: {
  points: TrendPoint[];
  className?: string;
}) {
  if (points.length < 2) return null;
  const top = points.reduce(
    (max, point) =>
      compareMoney(point.collected, max) > 0 ? point.collected : max,
    points[0]!.collected,
  );
  if (isZeroMoney(top) || isNegativeMoney(top)) return null;
  // A 1000 × 1000 plot, so each share is a whole coordinate as it stands.
  const line = points
    .map((point, index) => {
      const x = Math.round((index * 1000) / (points.length - 1));
      const y = 950 - Math.round((perMille(point.collected, top) ?? 0) * 0.9);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      aria-hidden
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      className={cn("h-6 w-16 shrink-0 fill-none stroke-accent", className)}
    >
      <polyline
        points={line}
        vectorEffect="non-scaling-stroke"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A compact figure (₹52.96 L), with the exact amount for a screen reader and a hover. */
export function Compact({ amount }: { amount: string }) {
  return (
    <span title={signedAmount(amount)}>
      <span aria-hidden>
        {formatCompactCurrency(amount).replace(/\.00$/, "")}
      </span>
      <span className="sr-only">{signedAmount(amount)}</span>
    </span>
  );
}

/** An unknown figure on the teal hero: a dash, never a zero. */
export function HeroUnknown() {
  return (
    <span className="opacity-60">
      —<span className="sr-only"> (unavailable)</span>
    </span>
  );
}

/** The dark-teal band every dashboard opens with. */
export const heroBandClass = "rounded-tile bg-accent-hover p-5 text-accent-ink";

/** One figure in the hero, between hairline dividers. */
export function HeroStat({
  label,
  value,
  caption,
}: {
  label: string;
  value: ReactNode | null;
  caption?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:px-4 sm:first:pl-0">
      <dt className="text-2xs font-medium tracking-[0.08em] uppercase opacity-80">
        {label}
      </dt>
      <dd className="text-title" data-numeric>
        {value ?? <HeroUnknown />}
      </dd>
      {caption === undefined ? null : (
        <dd className="text-caption opacity-75" data-numeric>
          {caption}
        </dd>
      )}
    </div>
  );
}

const RING_STROKE = {
  accent: "stroke-accent",
  positive: "stroke-positive-bright",
  warning: "stroke-warning-bright",
  critical: "stroke-critical-bright",
} as const;

export type RingTone = keyof typeof RING_STROKE;

/**
 * A share as a ring with the figure inside it. The circle's `pathLength` is
 * 1000, so the per-mille share is the stroke as is. `surface="hero"` draws it
 * light on the teal band. Nothing to measure shows a dash, never an empty
 * ring that reads as 0%.
 */
export function MiniRing({
  share,
  tone = "accent",
  label,
  surface = "card",
  text,
}: {
  share: number | null;
  tone?: RingTone;
  label: string;
  surface?: "card" | "hero";
  /** What the centre says; the percentage by default. */
  text?: string;
}) {
  const hero = surface === "hero";
  const size = hero ? "size-16" : "size-11";
  if (share === null) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-pill",
          size,
          hero ? "bg-accent-ink/10" : "bg-surface-sunken text-ink-subtle",
        )}
      >
        —
      </span>
    );
  }
  const filled = Math.min(share, 1000);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={filled / 10}
      aria-valuetext={text ?? formatPerMille(share)}
      className={cn("relative grid shrink-0 place-items-center", size)}
    >
      <svg
        aria-hidden
        viewBox="0 0 44 44"
        className="absolute inset-0 -rotate-90"
      >
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          strokeWidth="4"
          className={hero ? "stroke-accent-ink/15" : "stroke-surface-sunken"}
        />
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          strokeWidth="4"
          strokeLinecap={filled === 0 ? "butt" : "round"}
          pathLength={1000}
          strokeDasharray={`${filled} 1000`}
          className={hero ? "stroke-accent-ink" : RING_STROKE[tone]}
        />
      </svg>
      <span
        className={cn(
          "font-semibold",
          hero ? "text-label" : "text-2xs text-ink",
        )}
        data-numeric
      >
        {text ?? `${Math.floor(share / 10)}%`}
      </span>
    </span>
  );
}

export interface ActionRow {
  key: string;
  icon: Icon;
  tone: KpiTone;
  label: ReactNode;
  /** A second, quieter line: who, which line, how many are yours. */
  detail?: ReactNode;
  /** A count, an amount or a code chip, beside the chevron. */
  badge?: ReactNode;
  href: string;
}

/** A card of rows that each open the page resolving them. */
export function ActionList({
  title,
  rows,
  incomplete,
  empty,
  footer,
}: {
  title: string;
  rows: ActionRow[];
  /** Some source failed: say the list may be short, never that all is well. */
  incomplete: boolean;
  empty: string;
  footer?: ReactNode;
}) {
  return (
    <Card.Root surface="flat" className="min-w-0">
      <Card.Header
        title={title}
        actions={
          rows.length > 0 ? (
            <span className="rounded-pill bg-critical-subtle px-2 py-0.5 text-2xs font-semibold text-critical">
              {rows.length} open
            </span>
          ) : null
        }
      />
      <Card.Body className="pt-2">
        {incomplete ? (
          <FormMessage tone="critical">
            Some checks couldn’t run just now, so this list may be incomplete.
          </FormMessage>
        ) : null}
        {rows.length === 0 && !incomplete ? (
          <p className="flex items-center gap-2 text-body text-ink-muted">
            <SealCheck aria-hidden size={20} className="text-positive" />
            {empty}
          </p>
        ) : (
          <ul aria-label={title} className="flex flex-col gap-1">
            {rows.map((row) => (
              <li key={row.key}>
                <Link
                  href={row.href}
                  className="group flex items-center justify-between gap-3 rounded-control px-2 py-2 transition-colors hover:bg-surface-sunken"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-control",
                        KPI_ICON[row.tone],
                      )}
                    >
                      <row.icon size={15} weight="regular" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-body text-ink">{row.label}</span>
                      {row.detail ? (
                        <span className="text-caption text-ink-muted">
                          {row.detail}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-caption font-semibold text-ink">
                    {row.badge === undefined ? null : (
                      <span data-numeric>{row.badge}</span>
                    )}
                    <CaretRight
                      aria-hidden
                      size={14}
                      className="text-ink-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {footer}
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The Admin dashboard's attention items (US-082) as action rows — shared by
 * S-20 and S-07, so the two screens name and link each item the same way.
 */
export function attentionRows(
  items: readonly AttentionItem[],
  date: string,
): ActionRow[] {
  return items.map((item): ActionRow => {
    switch (item.kind) {
      case "PENDING_APPROVALS":
        return {
          key: "approvals",
          icon: ArrowsLeftRight,
          tone: "accent",
          label: "Corrections waiting",
          detail:
            item.awaitingYou === item.count
              ? "You can decide all of them"
              : `${item.awaitingYou} for you`,
          badge: item.count,
          href: "/collections/pending-approval",
        };
      case "DAY_NOT_CLOSED":
        return {
          key: `day-${item.lineId}`,
          icon: CalendarX,
          tone: "critical",
          label:
            item.status === "REOPENED"
              ? `${item.lineName} reopened — close it again`
              : `${item.lineName} not closed`,
          detail: `${item.lineCode} · day end tally waiting`,
          badge: <CodeChip>{item.lineCode}</CodeChip>,
          href: `/lines/${item.lineId}/day-closes/${date}`,
        };
      case "DISPUTED_HANDOVER":
        return {
          key: `handover-${item.handoverId}`,
          icon: HandCoins,
          tone: "critical",
          label: `${item.fromName}’s cash is disputed`,
          detail: `${item.lineName} · ${formatBusinessDate(item.businessDate, "day-month")}`,
          badge: signedAmount(item.discrepancy),
          href: `/lines/${item.lineId}/day-closes/${item.businessDate}`,
        };
      case "MISSED":
        return {
          key: `missed-${item.lineId}`,
          icon: Warning,
          tone: "critical",
          label: `${item.lineName}: customers missed`,
          detail: "Not visited before the day was closed",
          badge: item.count,
          href: `/lines/${item.lineId}/day-closes/${date}`,
        };
      case "NO_SENIOR":
      case "NO_JUNIOR":
        return {
          key: `${item.kind}-${item.lineId}`,
          icon: WarningCircle,
          tone: "warning",
          label: `${item.lineName} has no ${item.kind === "NO_SENIOR" ? "Senior" : "Junior"}`,
          detail:
            item.kind === "NO_SENIOR"
              ? "Nobody can close its day"
              : "Active accounts and nobody to collect",
          badge: <CodeChip>{item.lineCode}</CodeChip>,
          href: `/lines/${item.lineId}`,
        };
    }
  });
}

/** Field expenses waiting for a decision (Books, ADR-0018), as an action row. */
export function pendingExpensesRow(count: number | null): ActionRow[] {
  return count !== null && count > 0
    ? [
        {
          key: "expenses",
          icon: Receipt,
          tone: "warning",
          label: "Field expenses to approve",
          detail: "Fuel and travel claims from the field",
          badge: count,
          href: "/books/expenses?status=PENDING",
        },
      ]
    : [];
}
