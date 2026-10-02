"use client";

import { CalendarBlank, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { dayOfWeek, parseCalendarDate } from "@repo/domain";
import { cn, formatBusinessDate, formatCurrency } from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { useLayoutInUse } from "../../../lib/device-layout";
import type { HomeMenuItem, MenuBadge } from "../../../lib/home-menu";
import { WEEKDAYS } from "./dashboard-parts";
import type { ActionRow } from "./dashboard-visuals";

/**
 * The phone home, built to the native (Flutter / Material 3) Stitch screens
 * in "Rasi Mobile, all roles" (2026-10-02): "S-00 Super Admin Home", "Rasi
 * Admin Home (Android M3)" and "Rasi Senior Home (Android M3)". These are
 * the pieces those screens are made of — a deep-teal summary card, section
 * headers that sit outside their cards, white list cards of two-line rows
 * with tinted circle icons and pill chips, and a grid of rounded icon tiles.
 * The page reads the same data as the computer layout; only the composition
 * changes. Colour, type and radius are the `@theme` tokens.
 */

/** True when the console is in the phone layout — the frame `ConsoleShell` drew. */
export function usePhoneLayout(): boolean {
  return useLayoutInUse() === "mobile";
}

export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * An amount the way the designs print it, "₹1,76,320": `formatCurrency`'s
 * own string, its ".00" dropped only when there are no paise. Display only;
 * the amount itself is never touched.
 */
export function rupees(amount: string): string {
  return formatCurrency(amount).replace(/\.00$/, "");
}

/** The shared attention rows (S-07, S-20), as the native list's rows. */
export function homeRows(rows: readonly ActionRow[]): HomeRow[] {
  return rows.map((row) => ({
    key: row.key,
    icon: row.icon,
    tone: row.tone === "info" ? "accent" : row.tone,
    title: row.label,
    subtitle: row.detail,
    trailing:
      row.badge === undefined ? undefined : typeof row.badge === "number" ? (
        <Chip tone={row.tone === "info" ? "accent" : row.tone}>
          {row.badge}
        </Chip>
      ) : (
        row.badge
      ),
    href: row.href,
  }));
}

/** "Wed, 23 Sep", the designs' date. */
export function shortDate(date: string): string {
  return `${WEEKDAYS[dayOfWeek(parseCalendarDate(date))]!.slice(0, 3)}, ${formatBusinessDate(date, "day-month")}`;
}

/**
 * A date as tappable text: the phone's own date picker opens over it. A real
 * date input, so the keyboard and screen readers treat it as one.
 */
export function DateTap({
  shown,
  today,
  onDate,
  className,
  children,
}: {
  shown: string;
  today: string;
  onDate: (date: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("relative inline-flex items-center", className)}>
      {children}
      <span className="sr-only">Date</span>
      <input
        type="date"
        value={shown}
        max={today}
        onChange={(event) => {
          if (event.target.value) onDate(event.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

/** "Good afternoon, Sri" beside a white date chip (S-00). */
export function GreetingRow({
  title,
  shown,
  today,
  onDate,
}: {
  title: ReactNode;
  shown: string;
  today: string;
  onDate: (date: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <h1 className="min-w-0 truncate text-title text-ink">{title}</h1>
      <DateTap
        shown={shown}
        today={today}
        onDate={onDate}
        className="shrink-0 gap-1.5 rounded-pill border border-border bg-surface-raised px-2.5 py-1 text-caption font-semibold text-ink shadow-raised"
      >
        <CalendarBlank aria-hidden size={16} className="text-accent" />
        <span data-numeric>{shortDate(shown)}</span>
      </DateTap>
    </div>
  );
}

/** The deep-teal card every home opens with, a faint circle in its corner. */
export function SummaryCard({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "relative overflow-hidden rounded-overlay bg-accent-hover p-4 text-accent-ink shadow-raised",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 size-36 rounded-pill bg-accent-ink/5"
      />
      <div className="relative flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * A ring on the summary card: the share as the stroke, the figure inside.
 * `pathLength` is 1000, so the per-mille share is the stroke as it stands.
 */
export function SummaryRing({
  share,
  label,
  text,
  caption,
  size = "md",
  tone = "light",
}: {
  share: number | null;
  label: string;
  /** What the centre says. */
  text: string;
  /** A small word under the figure, inside the ring ("Pace", "visited"). */
  caption?: string;
  size?: "md" | "lg";
  /** `positive`: the green stroke the Admin's ring uses. */
  tone?: "light" | "positive";
}) {
  const filled = share === null ? 0 : Math.min(share, 1000);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={filled / 10}
      aria-valuetext={text}
      className={cn(
        "relative grid shrink-0 place-items-center",
        size === "lg" ? "size-17" : "size-16",
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 72 72"
        className="absolute inset-0 -rotate-90"
      >
        <circle
          cx="36"
          cy="36"
          r="30"
          fill="none"
          strokeWidth="6"
          className="stroke-accent-ink/20"
        />
        {share === null ? null : (
          <circle
            cx="36"
            cy="36"
            r="30"
            fill="none"
            strokeWidth="6"
            strokeLinecap={filled === 0 ? "butt" : "round"}
            pathLength={1000}
            strokeDasharray={`${filled} 1000`}
            className={
              tone === "positive"
                ? "stroke-positive-bright"
                : "stroke-accent-ink"
            }
          />
        )}
      </svg>
      <span className="flex flex-col items-center leading-none">
        <span
          className={cn(
            "font-semibold",
            size === "lg" ? "text-heading" : "text-caption",
          )}
          data-numeric
        >
          {text}
        </span>
        {caption ? (
          <span className="mt-0.5 text-2xs font-semibold tracking-wider uppercase opacity-80">
            {caption}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** Figures in a row across the summary card, split by faint dividers. */
export function SummaryStats({
  items,
  align = "start",
}: {
  items: { label: string; value: ReactNode; tone?: "positive" | "warning" }[];
  align?: "start" | "center";
}) {
  return (
    <dl className="grid auto-cols-fr grid-flow-col divide-x divide-accent-ink/15 border-t border-accent-ink/15 pt-3">
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "flex min-w-0 flex-col gap-0.5 px-2 first:pl-0 last:pr-0",
            align === "center" && "items-center text-center first:pl-2",
          )}
        >
          <dt
            className={cn(
              "truncate text-2xs opacity-75",
              align === "center" && "tracking-wide uppercase",
            )}
          >
            {item.label}
          </dt>
          <dd
            className={cn(
              "truncate font-semibold",
              align === "center" ? "text-body" : "text-label",
              item.tone === "positive" && "text-positive-subtle",
              item.tone === "warning" && "text-warning-subtle",
            )}
            data-numeric
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type ChipTone = "accent" | "positive" | "warning" | "critical" | "neutral";

const CHIP: Record<ChipTone, string> = {
  accent: "border-accent/20 bg-accent-subtle text-accent",
  positive: "border-positive-border bg-positive-subtle text-positive",
  warning: "border-warning-border bg-warning-subtle text-warning",
  critical: "border-critical-border bg-critical-subtle text-critical",
  neutral: "border-border bg-surface-sunken text-ink-muted",
};

/** A small pill: a count, a state, "3 open". */
export function Chip({
  tone,
  children,
  className,
}: {
  tone: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 text-2xs font-semibold",
        CHIP[tone],
        className,
      )}
      data-numeric
    >
      {children}
    </span>
  );
}

/**
 * A section's header, outside its card. `overline` is S-00's small uppercase
 * label ("NEEDS YOU", "MENU"); `heading` is the Admin and Senior screens'
 * ("Needs Attention", "Lines Today").
 */
export function SectionHeader({
  id,
  title,
  variant,
  dot,
  chip,
  aside,
}: {
  id?: string;
  title: string;
  variant: "overline" | "heading";
  /** A coral dot after the title: something here waits. */
  dot?: boolean;
  chip?: ReactNode;
  /** At the right: a link, or a count in words. */
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <h2
          id={id}
          className={
            variant === "overline"
              ? "text-caption font-semibold tracking-wider text-ink-muted uppercase"
              : "text-heading text-ink"
          }
        >
          {title}
        </h2>
        {dot ? (
          <span
            aria-hidden
            className="size-2 rounded-pill bg-critical-bright"
          />
        ) : null}
        {chip}
      </div>
      {aside}
    </div>
  );
}

/** "Review all", "See all": the link at a header's right. */
export function HeaderLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="shrink-0 text-caption font-semibold text-accent underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

const ICON_TONE: Record<ChipTone, string> = {
  accent: "border-accent/15 bg-accent-subtle text-accent",
  positive: "border-positive-border bg-positive-subtle text-positive",
  warning: "border-warning-border bg-warning-subtle text-warning",
  critical: "border-critical-border bg-critical-subtle text-critical",
  neutral: "border-border bg-surface-sunken text-ink-muted",
};

export interface HomeRow {
  key: string;
  icon: typeof CaretRight;
  tone: ChipTone;
  title: ReactNode;
  subtitle?: ReactNode;
  /** A count chip, a code chip, an inline action. */
  trailing?: ReactNode;
  /** The row opens this; absent when the trailing control is the action. */
  href?: string;
}

/** A white card of two-line rows, each with a tinted circle icon. */
export function ListCard({
  label,
  rows,
  empty,
}: {
  label: string;
  rows: HomeRow[];
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) {
    return (
      <p className="rounded-overlay border border-border bg-surface-raised p-4 text-body text-ink-muted shadow-raised">
        {empty}
      </p>
    );
  }
  return (
    <ul
      aria-label={label}
      className="divide-y divide-border overflow-hidden rounded-overlay border border-border bg-surface-raised shadow-raised"
    >
      {rows.map((row) => {
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-pill border",
                  ICON_TONE[row.tone],
                )}
              >
                <row.icon size={18} weight="regular" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-label font-semibold text-ink">
                  {row.title}
                </span>
                {row.subtitle ? (
                  <span className="truncate text-2xs text-ink-muted">
                    {row.subtitle}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {row.trailing}
              {row.href ? (
                <CaretRight aria-hidden size={16} className="text-ink-subtle" />
              ) : null}
            </span>
          </>
        );
        const frame =
          "flex min-h-13 items-center justify-between gap-3 px-3 py-3";
        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                href={row.href}
                className={cn(
                  frame,
                  "transition-colors active:bg-surface-sunken",
                )}
              >
                {body}
              </Link>
            ) : (
              <div className={frame}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The menu: rounded icon tiles, four to a row. `card` holds them in one
 * white card (S-00, Admin); `tiles` gives each its own bordered tile (Senior).
 * A count rides on the icon when the page knows one.
 */
export function MenuGrid({
  items,
  counts,
  variant,
  header,
}: {
  items: HomeMenuItem[];
  counts: Partial<Record<MenuBadge, number | null>>;
  variant: "card" | "tiles";
  /** Drawn inside the card (Admin) — absent, the page draws its own above. */
  header?: ReactNode;
}) {
  const grid = (
    <ul
      className={cn(
        "grid grid-cols-4",
        variant === "card" ? "gap-x-2 gap-y-3.5" : "gap-2.5",
      )}
    >
      {items.map((item) => {
        const count = item.badge ? (counts[item.badge] ?? null) : null;
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-label={
                count ? `${item.label}, ${count} waiting` : item.label
              }
              className={cn(
                "group flex flex-col items-center text-center transition-transform active:scale-95 motion-reduce:transition-none",
                variant === "tiles" &&
                  "min-h-19 justify-center rounded-overlay border border-border bg-surface-raised p-2 shadow-raised",
              )}
            >
              <span
                className={cn(
                  "relative grid place-items-center border border-accent/10 bg-accent-subtle text-accent shadow-raised transition-colors group-hover:bg-accent group-hover:text-accent-ink",
                  variant === "card"
                    ? "size-13 rounded-overlay"
                    : "size-11.5 rounded-surface",
                )}
              >
                <item.icon aria-hidden size={24} weight="regular" />
                {count ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -top-1 -right-1 grid h-4.5 min-w-4.5 place-items-center rounded-pill border-2 border-surface-raised px-1 text-2xs leading-none font-semibold text-ink-inverse",
                      item.badge === "handovers" ? "bg-warning" : "bg-critical",
                    )}
                    data-numeric
                  >
                    {count}
                  </span>
                ) : null}
              </span>
              <span className="mt-1.5 w-full truncate text-caption leading-tight font-medium text-ink">
                {item.label}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return variant === "card" ? (
    <div className="flex flex-col gap-3 rounded-overlay border border-border bg-surface-raised p-3 shadow-raised">
      {header}
      {grid}
    </div>
  ) : (
    grid
  );
}

/** A plain white card on the home (Today's collections, a line). */
export function HomeCard({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <section
      {...rest}
      className={cn(
        "flex flex-col gap-2 rounded-overlay border border-border bg-surface-raised p-3.5 shadow-raised",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A thin progress bar; `tone` follows the thing measured (a tallied line is green). */
export function Bar({
  share,
  label,
  tone = "accent",
  size = "sm",
}: {
  share: number;
  label: string;
  tone?: "accent" | "positive" | "neutral";
  size?: "sm" | "md";
}) {
  const filled = Math.min(share, 1000);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={filled / 10}
      className={cn(
        "block w-full overflow-hidden rounded-pill bg-surface-sunken",
        size === "md" ? "h-2.5 p-0.5" : "h-1.5",
      )}
    >
      <span
        className={cn(
          "block h-full rounded-pill",
          tone === "accent" && "bg-accent",
          tone === "positive" && "bg-positive",
          tone === "neutral" && "bg-ink-subtle",
        )}
        style={{ width: `${filled / 10}%` }}
      />
    </span>
  );
}

/**
 * The one action a home is for, held above the tab bar while the page
 * scrolls under it: the Senior's "Close the day" (full width) or the Admin's
 * "New customer" (an extended button at the right).
 */
export function StickyAction({
  align = "stretch",
  children,
}: {
  align?: "stretch" | "end";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-[calc(var(--shell-bottom)+0.75rem)] z-10 mt-auto flex",
        align === "end" ? "justify-end" : "flex-col",
      )}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------- the sector comparison's

/**
 * The top of a phone page that is not a home (the sector comparison): who
 * and when, and a date chip that opens the phone's own date picker.
 */
export function PhoneGreeting({
  title,
  shown,
  today,
  onDate,
  children,
}: {
  name: string;
  title: ReactNode;
  shown: string;
  today: string;
  onDate: (date: string) => void;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <GreetingRow title={title} shown={shown} today={today} onDate={onDate} />
      {children ? (
        <div className="flex flex-wrap items-center gap-2 px-0.5 text-caption text-ink-muted">
          {children}
        </div>
      ) : null}
    </header>
  );
}

/** A white card with an optional heading. */
export function PhoneCard({
  title,
  action,
  children,
  className,
  ...rest
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <HomeCard {...rest} className={cn("gap-3", className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-heading text-ink">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </HomeCard>
  );
}

/** Three small figures under a line, divided by hairlines. */
export function FigureRow({
  items,
}: {
  items: { label: string; value: ReactNode; tone?: "warning" | "critical" }[];
}) {
  return (
    <dl className="grid auto-cols-fr grid-flow-col divide-x divide-border border-t border-border pt-2.5">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex min-w-0 flex-col items-center gap-0.5 px-1"
        >
          <dt className="text-2xs text-ink-muted">{item.label}</dt>
          <dd
            className={cn(
              "text-caption font-semibold",
              item.tone === "warning" && "text-warning",
              item.tone === "critical" && "text-critical",
              !item.tone && "text-ink",
            )}
            data-numeric
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
