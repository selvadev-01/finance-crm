"use client";

import { Button, DetailSkeleton, FormMessage, NotPermitted } from "@repo/ui";
import type { ReactNode } from "react";

/** A read that failed for a reason other than scope: say so, offer a retry. */
export function LoadFailed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <FormMessage
      tone="critical"
      action={
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {message}
    </FormMessage>
  );
}

/**
 * A record the API answered `404` for: it does not exist, or is outside the
 * viewer's access — deliberately indistinguishable (M02).
 */
export function RecordNotFound({ noun }: { noun: string }) {
  return (
    <div className="rounded-surface border border-border bg-surface-raised">
      <NotPermitted
        title={`${noun} not found`}
        description={`This ${noun.toLowerCase()} doesn’t exist, or it’s outside your access. Ask an Admin if you think that is wrong.`}
      />
    </div>
  );
}

type Unsettled =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "not-permitted" }
  | { status: "error"; message: string };

/**
 * What a detail page shows until its record is ready. The page narrows on
 * `status` itself, so the record is typed once this returns:
 *
 *   if (line.status !== "ready") return <RecordFallback query={line} noun="Line" />;
 */
export function RecordFallback({
  query,
  noun,
  loading = <DetailSkeleton />,
}: {
  query: Unsettled & { reload: () => void };
  noun: string;
  /** The page's own loading shape, when it is not a detail page. */
  loading?: ReactNode;
}) {
  switch (query.status) {
    case "loading":
      return loading;
    case "not-found":
    case "not-permitted":
      return <RecordNotFound noun={noun} />;
    case "error":
      return <LoadFailed message={query.message} onRetry={query.reload} />;
  }
}
