import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * The top of a console page: where this is, what it is, and the page's own
 * actions.
 *
 * `trail` carries the levels above — `Breadcrumbs` built from the rollup chain
 * (navigation-ia.md#drill-down-follows-the-rollup-chain). `meta` is the
 * record's code and status, on one line under the title; `description` is a
 * sentence about the page.
 *
 * `eyebrow` is the older name for `trail`, kept while screens move over
 * (ADR-0013 roll-out).
 */
export interface PageHeaderProps {
  title: ReactNode;
  trail?: ReactNode;
  /** @deprecated Use `trail`. */
  eyebrow?: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  /** Buttons for this page. They wrap under the title on a narrow screen. */
  actions?: ReactNode;
  /**
   * A dashboard's headline figures beside the title — `RadialMeter`s. Hidden
   * below 768px, where the page's own figures come straight after the title.
   */
  summary?: ReactNode;
  /** `ruled` closes the header with a rule; `hero` opens a dashboard, unruled (ADR-0015). */
  frame?: "ruled" | "hero";
  className?: string;
}

export function PageHeader({
  title,
  trail,
  eyebrow,
  meta,
  description,
  actions,
  summary,
  frame = "ruled",
  className,
}: PageHeaderProps) {
  const above = trail ?? eyebrow;
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
        frame === "ruled" && "border-b border-border pb-5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        {above ? (
          <div className="text-label text-ink-muted">{above}</div>
        ) : null}
        <h1 className="text-display text-balance text-ink">{title}</h1>
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-muted">
            {meta}
          </div>
        ) : null}
        {description ? (
          <div className="max-w-[70ch] text-body text-ink-muted">
            {description}
          </div>
        ) : null}
      </div>
      {actions || summary ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {summary ? (
            <div className="hidden items-center gap-5 md:flex">{summary}</div>
          ) : null}
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
