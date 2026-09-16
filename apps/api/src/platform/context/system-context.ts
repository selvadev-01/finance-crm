/**
 * What a scheduled job acts as (M14). A job has no caller, so it has no
 * `RequestContext` — but it is still scoped: every job runs **for one
 * organization**, and every query it makes filters by `organizationId`, the
 * job-side form of non-negotiable 3. Its audit entries carry a null actor and
 * are labelled as system (M13).
 */
export interface SystemContext {
  readonly organizationId: string;
  /** The job run, for logs and the audit entry. */
  readonly runId: string;
}
