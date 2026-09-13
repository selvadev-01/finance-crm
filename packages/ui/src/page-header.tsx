import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * The top of a console page: what this is, and the page's own actions.
 *
 * `eyebrow` carries the level above — the sector a line belongs to — so the
 * rollup chain (navigation-ia.md#drill-down-follows-the-rollup-chain) is
 * visible without breadcrumbs three levels deep.
 */
export interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Buttons for this page. They wrap under the title on a narrow screen. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <div className="text-sm text-ink-muted">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {description ? (
          <div className="text-sm text-ink-muted">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
