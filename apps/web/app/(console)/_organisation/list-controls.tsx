"use client";

import { Button, FormMessage, NotPermitted } from "@repo/ui";
import type { ReactNode } from "react";

/** "Show inactive" — inactive sectors and lines are hidden by default (M03). */
export function ShowInactiveToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex h-[var(--control-height)] items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--color-accent)]"
      />
      Show inactive
    </label>
  );
}

/** A read that failed for a reason other than scope: say so, offer a retry. */
export function LoadFailed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <FormMessage tone="critical">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>{message}</span>
        <Button tone="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </FormMessage>
  );
}

/**
 * A detail page whose record the API answered `404` for: it does not exist, or
 * is outside the viewer's access — deliberately indistinguishable (M02).
 */
export function RecordNotFound({ noun }: { noun: string }) {
  return (
    <Surface>
      <NotPermitted
        title={`${noun} not found`}
        description={`This ${noun.toLowerCase()} doesn’t exist, or it’s outside your access. Ask an Admin if you think that is wrong.`}
      />
    </Surface>
  );
}

/** The bordered surface an empty state sits in, matching the table's frame. */
export function Surface({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-surface)] border border-border bg-surface-raised">
      {children}
    </div>
  );
}

/**
 * Lists here ask for up to 200 rows, the API's page limit — far above the
 * number of sectors or lines a business runs. If that is ever exceeded the
 * screen says so rather than silently showing a partial list.
 */
export function TruncatedNote({ noun }: { noun: string }) {
  return (
    <p className="text-sm text-ink-muted">
      Showing the first 200 {noun}. Narrow the list with a filter to see the rest.
    </p>
  );
}

export const LIST_LIMIT = 200;
