import { cva, type VariantProps } from "class-variance-authority";
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useId,
} from "react";

import { cn } from "./cn";

/* -------------------------------------------------------------------------
 * Section — a titled part of a page: "Juniors", "Corrections", "History".
 * The heading level is h2 by default; the region is labelled by its title.
 * ---------------------------------------------------------------------- */

interface SectionProps extends Omit<ComponentProps<"section">, "title"> {
  title: ReactNode;
  /** One muted line under the title. */
  description?: ReactNode;
  /** Buttons for this section, at the heading's right. */
  actions?: ReactNode;
  /** Heading level; `h3` for a section inside a tab or a card. */
  as?: "h2" | "h3";
}

export function Section({
  title,
  description,
  actions,
  as: Heading = "h2",
  className,
  children,
  ...props
}: SectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-3", className)}
      {...props}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading id={headingId} className="text-heading text-ink">
            {title}
          </Heading>
          {description ? (
            <p className="text-caption text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Card — a bordered surface. Use it where a boundary means something (a
 * panel of settings, a list of references); otherwise group with space.
 * ---------------------------------------------------------------------- */

function CardRoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-surface border border-border bg-surface-raised shadow-raised",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 py-2",
        className,
      )}
    >
      <h3 className="text-label text-ink">{title}</h3>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

function CardBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-[var(--stack-gap)] p-4", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-sunken px-4 py-2.5",
        className,
      )}
      {...props}
    />
  );
}

export const Card = {
  Root: CardRoot,
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
};

/* -------------------------------------------------------------------------
 * Stat — one figure and what it is: "Collected ₹12,400.00". The value is
 * formatted by the caller (formatCurrency); this only lays it out.
 * ---------------------------------------------------------------------- */

const statGrid = cva(
  "grid gap-px overflow-hidden rounded-surface border border-border bg-border shadow-raised",
  {
    variants: {
      columns: {
        2: "grid-cols-1 sm:grid-cols-2",
        3: "grid-cols-1 sm:grid-cols-3",
        4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
      },
    },
    defaultVariants: { columns: 4 },
  },
);

/**
 * Figures side by side, ruled like a ledger's totals row: one frame, hairline
 * dividers, no card per figure.
 */
export function StatGrid({
  columns,
  className,
  ...props
}: ComponentProps<"dl"> & VariantProps<typeof statGrid>) {
  return <dl className={cn(statGrid({ columns }), className)} {...props} />;
}

const statValue = cva("text-title tabular-nums", {
  variants: {
    tone: {
      neutral: "text-ink",
      positive: "text-positive",
      warning: "text-warning",
      critical: "text-critical",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface StatProps extends VariantProps<typeof statValue> {
  label: ReactNode;
  children: ReactNode;
  /** A muted line under the figure: "of ₹30,000.00 expected". */
  hint?: ReactNode;
  className?: string;
}

/**
 * `tone` colours the figure only when it is itself a status — a shortfall,
 * a surplus. A total is `neutral`, however large.
 */
export function Stat({ label, children, hint, tone, className }: StatProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 bg-surface-raised px-4 py-3",
        className,
      )}
    >
      <dt className="text-2xs font-medium tracking-wider text-ink-subtle uppercase">
        {label}
      </dt>
      <dd className={statValue({ tone })} data-numeric>
        {children}
      </dd>
      {hint ? <dd className="text-caption text-ink-muted">{hint}</dd> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * DescriptionList — a record's fields: "Mobile 98765 43210".
 * ---------------------------------------------------------------------- */

const descriptionList = cva("text-body", {
  variants: {
    layout: {
      /** Label beside value, one per row — a profile panel. */
      rows: "grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2.5",
      /** Label above value, in columns — a summary strip. */
      columns: "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3",
    },
  },
  defaultVariants: { layout: "rows" },
});

export function DescriptionList({
  layout,
  className,
  children,
  ...props
}: ComponentProps<"dl"> & VariantProps<typeof descriptionList>) {
  return (
    <dl
      className={cn(descriptionList({ layout }), className)}
      data-layout={layout ?? "rows"}
      {...props}
    >
      {children}
    </dl>
  );
}

/**
 * One term and its value. A missing value shows an em dash, so a gap in the
 * record reads as "not recorded" rather than as a rendering fault.
 */
export function Description({
  term,
  children,
}: {
  term: ReactNode;
  children?: ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="contents [[data-layout=columns]_&]:flex [[data-layout=columns]_&]:flex-col [[data-layout=columns]_&]:gap-0.5">
      <dt className="text-ink-muted">{term}</dt>
      {/* Tabular figures throughout: values here are often amounts and counts. */}
      <dd
        className={cn(
          "min-w-0 break-words text-ink tabular-nums",
          empty && "text-ink-subtle",
        )}
      >
        {empty ? "—" : children}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * RecordIdentity — the first cell of a row: a name, and the code under it.
 * ---------------------------------------------------------------------- */

/** The class for a record's name when it is a link. */
export const recordLinkClass =
  "font-medium text-ink underline-offset-4 hover:text-accent hover:underline";

export function RecordIdentity({
  children,
  code,
  className,
}: {
  /** The name — plain text, or a `Link` styled with `recordLinkClass`. */
  children: ReactNode;
  code?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <span className="truncate font-medium text-ink">{children}</span>
      {code ? (
        <span className="truncate font-mono text-2xs text-ink-muted">
          {code}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A short code in a quiet chip, beside a name: `LN-07` Market Road. For the
 * code as the record's own identity, use `RecordIdentity` instead.
 */
export function CodeChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-sm border border-border bg-surface-sunken px-1.5 font-mono text-2xs leading-5 text-ink-muted">
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Breadcrumbs — the rollup chain above a page title
 * (navigation-ia.md#drill-down-follows-the-rollup-chain).
 * ---------------------------------------------------------------------- */

/**
 * Each child is one step — a `Link` for the levels above, plain text for
 * where the reader is. Separators are drawn here.
 */
export function Breadcrumbs({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const steps = Children.toArray(children).filter(isValidElement);
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label text-ink-muted">
        {steps.map((step, index) => (
          <li key={step.key ?? index} className="flex items-center gap-1.5">
            {index > 0 ? (
              <span aria-hidden className="text-ink-subtle">
                /
              </span>
            ) : null}
            <span
              className="[&_a]:underline-offset-4 [&_a]:hover:text-ink [&_a]:hover:underline"
              aria-current={index === steps.length - 1 ? "page" : undefined}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* -------------------------------------------------------------------------
 * Skeletons — the loading state is the page's own shape, not a spinner.
 * ---------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "h-4 animate-pulse rounded-sm bg-surface-sunken motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/** A detail page loading: header, a row of figures, a section. */
export function DetailSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col gap-[var(--section-gap)]"
    >
      <div className="flex flex-col gap-2 border-b border-border pb-5">
        <Skeleton className="w-40" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="w-56" />
      </div>
      <div className="grid gap-px overflow-hidden rounded-surface border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((cell) => (
          <div
            key={cell}
            className="flex flex-col gap-2 bg-surface-raised px-4 py-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="w-32" />
        <div className="flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-4">
          <Skeleton className="w-full" />
          <Skeleton className="w-5/6" />
          <Skeleton className="w-2/3" />
        </div>
      </div>
    </div>
  );
}
