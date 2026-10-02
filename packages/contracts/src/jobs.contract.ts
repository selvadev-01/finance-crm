import { z } from "zod";

import { route } from "./route.js";
import { errorSchema } from "./shared.js";

/**
 * M14 · the scheduled jobs and how each last ran for the caller's
 * organization (Admin+, `job.view`). Read-only: there is no replay here.
 */

export const jobStatusSchema = z.object({
  /** `reconcile-balances`, `dispatch-emails`, …. */
  job: z.string(),
  /** The cron expression, in Asia/Kolkata (M14). */
  schedule: z.string(),
  /** Null when it has never run for this organization. */
  lastStartedAt: z.string().nullable(),
  lastFinishedAt: z.string().nullable(),
  lastOutcome: z.enum(["RUNNING", "SUCCEEDED", "FAILED"]).nullable(),
  /** The failure's class and code — never its message. */
  lastError: z.string().nullable(),
  lastSucceededAt: z.string().nullable(),
  /** When it last exhausted its retries and alerted the Admins. */
  deadLetteredAt: z.string().nullable(),
});

export const jobsOverviewSchema = z.object({
  /** False where this API process does not run the worker (M14). */
  workerEnabled: z.boolean(),
  jobs: z.array(jobStatusSchema),
});

export const jobsContract = {
  listJobs: route({
    method: "GET",
    path: "/api/jobs",
    summary:
      "The scheduled jobs and each one's latest run for this organization (M14, Admin+)",
    responses: {
      200: jobsOverviewSchema,
      401: errorSchema,
      403: errorSchema,
    },
  }),
} as const;

export type JobStatusView = z.infer<typeof jobStatusSchema>;
export type JobsOverview = z.infer<typeof jobsOverviewSchema>;
