import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * Three empty states, as three components.
 *
 * The screen specs are explicit that a list must distinguish *no data yet*
 * from *no results for this filter* from *nothing you are permitted to see* —
 * and that these are three different components, not one "No results" with a
 * `variant` prop. The distinction matters operationally:
 *
 *   - Nothing yet → the user should create something. Offer the action.
 *   - No matches → the user should change the filter. Offer to clear it.
 *   - Not permitted → neither. Telling a Junior to "add a customer" for a line
 *     they cannot see is worse than saying nothing, and an empty list that
 *     looks like "no data" hides a permissions problem from whoever is
 *     debugging it.
 *
 * Out-of-scope rows return 404 rather than 403 at the API, so this component
 * is often the only place a scoping boundary is visible at all.
 */
type EmptyStateShellProps = {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

function EmptyStateShell({
  title,
  description,
  action,
  className,
}: EmptyStateShellProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="max-w-[42ch] text-sm text-ink-muted">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

/** Nothing has been created yet. The user can fix this — offer the action. */
export function NothingYet(props: EmptyStateShellProps) {
  return <EmptyStateShell {...props} />;
}

/** A filter or search excluded everything. Offer a way back. */
export function NoMatches(props: EmptyStateShellProps) {
  return <EmptyStateShell {...props} />;
}

/**
 * The viewer's role or line scope excludes this data.
 *
 * Deliberately takes no `action`: there is nothing for this user to do, and
 * offering one would invite them to try something that will 404.
 */
export function NotPermitted({
  title = "Not available to you",
  description = "This belongs to a line or sector outside your access. Ask an Admin if you think that is wrong.",
  className,
}: Partial<Omit<EmptyStateShellProps, "action">>) {
  return (
    <EmptyStateShell
      title={title}
      description={description}
      className={className}
    />
  );
}
