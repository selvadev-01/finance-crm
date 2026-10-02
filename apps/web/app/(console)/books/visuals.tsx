"use client";

import {
  Bank,
  DotsThreeCircle,
  GasPump,
  House,
  Info,
  Percent,
  Phone,
  Printer,
  Receipt,
  Users,
} from "@phosphor-icons/react/dist/ssr";
import { cn, formatCurrency } from "@repo/ui";
import { createElement, type ReactNode } from "react";

import {
  absMoney,
  compareMoney,
  formatPerMille,
  isNegativeMoney,
  perMille,
  sumMoney,
} from "../../../lib/money";

type Icon = typeof Receipt;

/**
 * The Books redesign's shared pieces (Stitch B-01…B-13, 2026-10-02): an icon
 * per expense category, holding cards for "where the money is", a share bar,
 * and bar rows. Tokens only — teal for the business's money, ink for the
 * rest; status colours stay for status (design-system.md).
 */

const CATEGORY_ICONS: [RegExp, Icon][] = [
  [/salar|wage|staff/i, Users],
  [/rent|office|lease/i, House],
  [/fuel|travel|petrol|transport/i, GasPump],
  [/phone|internet|mobile/i, Phone],
  [/station|print/i, Printer],
  [/bank/i, Bank],
  [/interest/i, Percent],
  [/misc|other/i, DotsThreeCircle],
];

/** An icon for a category by its name; a receipt when nothing matches. */
export function categoryIcon(name: string): Icon {
  return CATEGORY_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? Receipt;
}

/** A category's icon, drawn by name — `categoryIcon` as an element. */
export function CategoryIcon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return createElement(categoryIcon(name), {
    "aria-hidden": true,
    size,
    weight: "regular",
    className,
  });
}

/** A signed amount with a true minus sign (U+2212), as every signed figure. */
export function signedAmount(amount: string): string {
  return isNegativeMoney(amount)
    ? `−${formatCurrency(absMoney(amount))}`
    : formatCurrency(amount);
}

/**
 * A standing explanation on a page — how a statement is read, what a journal
 * may touch. Static, so no live-region role: `FormMessage` announces itself,
 * which suits a form's outcome, not a note that is there on every load.
 */
export function Note({
  size = "body",
  children,
}: {
  size?: "body" | "caption";
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start rounded-control border border-info-border bg-info-subtle text-ink",
        size === "body"
          ? "gap-3 px-4 py-3 text-body"
          : "gap-2 px-3 py-2 text-caption",
      )}
    >
      <Info
        aria-hidden
        size={size === "body" ? 20 : 16}
        weight="regular"
        className="mt-px shrink-0 text-info"
      />
      <span>{children}</span>
    </p>
  );
}

/** An icon in a teal-wash circle, the Books cards' leading mark. */
export function IconMark({
  icon: Mark,
  tone = "accent",
}: {
  icon: Icon;
  tone?: "accent" | "warning";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-pill",
        tone === "accent"
          ? "bg-accent-subtle text-accent"
          : "bg-warning-subtle text-warning",
      )}
    >
      <Mark size={18} weight="regular" />
    </span>
  );
}

/**
 * One place money is held: an uppercase label, the amount, a plain caption.
 * A negative balance says so in words and in coral — that is a status.
 */
export function HoldingCard({
  icon,
  label,
  amount,
  caption,
}: {
  icon: Icon;
  label: string;
  amount: string;
  caption: ReactNode;
}) {
  const negative = isNegativeMoney(amount);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-surface border border-border bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
          {label}
        </span>
        <IconMark icon={icon} />
      </div>
      <span
        className={cn("text-title text-ink", negative && "text-critical")}
        data-numeric
      >
        {signedAmount(amount)}
      </span>
      <span className="text-caption text-ink-muted">{caption}</span>
    </li>
  );
}

/**
 * A choice made by tapping a tile — a category, where money was paid from —
 * as a radio group, so the keyboard and screen readers treat it as one.
 */
export function TileChoice<Value extends string>({
  label,
  value,
  onChange,
  options,
  columns = 4,
  invalid,
  describedBy,
}: {
  label: string;
  value: Value | "" | undefined;
  onChange: (value: Value) => void;
  options: readonly {
    value: Value;
    label: string;
    icon?: Icon;
    caption?: ReactNode;
    disabled?: boolean;
  }[];
  columns?: 2 | 3 | 4;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(
        "grid gap-2",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-2 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Mark = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-11 flex-col items-start gap-1.5 rounded-control border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "border-accent bg-accent-subtle"
                : "border-border bg-surface-raised hover:border-border-strong",
              invalid && !selected && "border-critical-border",
            )}
          >
            {Mark ? (
              <Mark
                aria-hidden
                size={20}
                weight="regular"
                className={selected ? "text-accent" : "text-ink-muted"}
              />
            ) : null}
            <span
              className={cn(
                "text-label",
                selected ? "font-medium text-accent" : "text-ink",
              )}
            >
              {option.label}
            </span>
            {option.caption ? (
              <span className="text-caption text-ink-muted" data-numeric>
                {option.caption}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Teal for the business's own holdings first, then quieter shades. */
const SHARE_FILLS = [
  "bg-accent",
  "bg-accent/60",
  "bg-ink-subtle",
  "bg-border-strong",
  "bg-accent/30",
  "bg-ink-muted",
];

/**
 * The whole split into its parts, as one thin bar with a legend. Negative or
 * zero parts are left out: a share of a whole cannot be below nothing.
 */
export function ShareBar({
  label,
  parts,
}: {
  label: string;
  parts: readonly { key: string; label: string; amount: string }[];
}) {
  const shown = parts.filter(
    (part) => !isNegativeMoney(part.amount) && part.amount !== "0.00",
  );
  const total = sumMoney(shown.map((part) => part.amount));
  if (shown.length === 0) return null;
  return (
    <figure className="flex flex-col gap-3" aria-label={label}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken">
        {shown.map((part, index) => (
          <span
            key={part.key}
            className={SHARE_FILLS[index % SHARE_FILLS.length]}
            style={{ width: `${(perMille(part.amount, total) ?? 0) / 10}%` }}
          />
        ))}
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-caption text-ink-muted">
          {shown.map((part, index) => (
            <li key={part.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-pill",
                  SHARE_FILLS[index % SHARE_FILLS.length],
                )}
              />
              {part.label}
              <span className="font-medium text-ink" data-numeric>
                {formatPerMille(perMille(part.amount, total) ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/**
 * A label, its amount, and a thin bar for its share of the largest row — the
 * category breakdowns on Expenses and Profit & loss.
 */
export function BarRows({
  label,
  rows,
  footer,
}: {
  label: string;
  rows: readonly { key: string; label: ReactNode; amount: string }[];
  footer?: ReactNode;
}) {
  const largest = rows.reduce(
    (max, row) => (compareMoney(row.amount, max) > 0 ? row.amount : max),
    "0.00",
  );
  const total = sumMoney(rows.map((row) => row.amount));
  return (
    <ul className="flex flex-col gap-3.5" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-body">
            <span className="min-w-0 text-ink">{row.label}</span>
            <span className="shrink-0 text-ink" data-numeric>
              {formatCurrency(row.amount)}
              <span className="ml-1.5 text-caption text-ink-muted">
                {formatPerMille(perMille(row.amount, total) ?? 0)}
              </span>
            </span>
          </div>
          <span className="block h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken">
            <span
              className="block h-full rounded-pill bg-accent"
              style={{
                width: `${Math.min(perMille(row.amount, largest) ?? 0, 1000) / 10}%`,
              }}
            />
          </span>
        </li>
      ))}
      {footer}
    </ul>
  );
}
