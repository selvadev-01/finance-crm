"use client";

import { jobsContract, type JobStatusView } from "@repo/contracts";
import {
  Badge,
  Card,
  EmptyFrame,
  FormMessage,
  ListSkeleton,
  NotPermitted,
  PageHeader,
} from "@repo/ui";

import { LoadFailed } from "../../../../components/query-state";
import { formatTimestamp } from "../../../../lib/format";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";

/** What each scheduled job is for, in the business's words (M14). */
const JOBS: Record<
  string,
  { name: string; purpose: string; when: string; cron: string }
> = {
  "reconcile-balances": {
    name: "Nightly reconciliation",
    purpose:
      "Rebuilds every ledger balance from its postings and checks each account against the ledger.",
    when: "Every night at 01:00",
    cron: "0 1 * * *",
  },
  "flag-overdue-accounts": {
    name: "Overdue accounts",
    purpose:
      "Marks accounts past their target date with money still owed, and tells each line's Senior.",
    when: "Every night at 00:30",
    cron: "30 0 * * *",
  },
  "purge-idempotency-keys": {
    name: "Sync key clean-up",
    purpose:
      "Forgets the phones' 90-day-old sync keys, which have long since done their job.",
    when: "Every night at 02:00",
    cron: "0 2 * * *",
  },
  "dispatch-notifications": {
    name: "Push delivery",
    purpose: "Sends waiting push notifications to phones and browsers.",
    when: "Every minute",
    cron: "* * * * *",
  },
  "dispatch-emails": {
    name: "Email delivery",
    purpose: "Sends waiting alert and account emails.",
    when: "Every minute",
    cron: "* * * * *",
  },
  "deactivate-stale-subscriptions": {
    name: "Stale device clean-up",
    purpose: "Stops pushing to devices that have not been seen for 90 days.",
    when: "Every Sunday at 03:00",
    cron: "0 3 * * 0",
  },
};

/**
 * M14 · the scheduled jobs and how each last ran for this business, so an
 * Admin can see that the nightly work happened and when anything last failed
 * for good. Read-only — there is no replay. Admins and Super Admins
 * (`job.view`); the API refuses anyone else regardless.
 */
export function JobStatusScreen() {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const overview = useApiQuery(jobsContract.listJobs, allowed ? {} : null);

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="Scheduled jobs are for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  return (
    <>
      <PageHeader
        title="Scheduled jobs"
        description="The work Rasi does on its own, and how each last ran for this business. A job that fails five times alerts the Admins."
      />
      {overview.status === "loading" ? (
        <ListSkeleton columns={3} rows={6} />
      ) : null}
      {overview.status === "error" ? (
        <LoadFailed message={overview.message} onRetry={overview.reload} />
      ) : null}
      {overview.status === "ready" ? (
        <>
          {overview.data.workerEnabled ? null : (
            <FormMessage tone="warning">
              The job worker is off on this server, so nothing below will run
              until one with it on is started.
            </FormMessage>
          )}
          <ul className="flex flex-col gap-2" aria-label="Scheduled jobs">
            {overview.data.jobs.map((job) => (
              <li key={job.job}>
                <JobCard job={job} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function JobCard({ job }: { job: JobStatusView }) {
  const known = JOBS[job.job];
  const name = known?.name ?? job.job;
  // A schedule changed on this server is shown as it is, not as the default.
  const when =
    known && known.cron === job.schedule
      ? known.when
      : `Cron ${job.schedule}, Indian time`;
  const purpose = known?.purpose ?? "";
  return (
    <Card.Root>
      <Card.Body className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium text-ink">{name}</span>
            <span className="text-caption text-ink-muted">
              {when}
              {purpose ? ` · ${purpose}` : ""}
            </span>
          </span>
          <Outcome job={job} />
        </div>
        <p className="text-caption text-ink-muted">
          {job.lastStartedAt
            ? `Last ran ${formatTimestamp(job.lastStartedAt)}`
            : "Has not run yet for this business."}
          {job.lastOutcome === "FAILED" && job.lastSucceededAt
            ? ` · last succeeded ${formatTimestamp(job.lastSucceededAt)}`
            : ""}
          {job.lastError ? ` · ${job.lastError}` : ""}
        </p>
        {job.deadLetteredAt ? (
          <FormMessage tone="critical">
            Gave up after five attempts on {formatTimestamp(job.deadLetteredAt)}
            , and the Admins were alerted.
          </FormMessage>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

function Outcome({ job }: { job: JobStatusView }) {
  switch (job.lastOutcome) {
    case "SUCCEEDED":
      return <Badge tone="positive">Succeeded</Badge>;
    case "FAILED":
      return <Badge tone="critical">Failed</Badge>;
    case "RUNNING":
      return <Badge tone="info">Running</Badge>;
    default:
      return <Badge tone="neutral">Not run yet</Badge>;
  }
}
