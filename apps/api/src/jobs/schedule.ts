import type { AppConfig } from '../platform/config/config.js';

/**
 * M14's scheduled jobs and their crons (Asia/Kolkata), in one place: the
 * worker registers these, and the job status screen lists them — so a job
 * that has never run is still shown, as not yet run.
 */
export function jobSchedules(
  config: Pick<
    AppConfig,
    | 'JOBS_RECONCILE_CRON'
    | 'JOBS_OVERDUE_CRON'
    | 'JOBS_PURGE_KEYS_CRON'
    | 'JOBS_STALE_SUBSCRIPTIONS_CRON'
  >,
): { name: string; cron: string }[] {
  return [
    { name: 'reconcile-balances', cron: config.JOBS_RECONCILE_CRON },
    { name: 'flag-overdue-accounts', cron: config.JOBS_OVERDUE_CRON },
    { name: 'purge-idempotency-keys', cron: config.JOBS_PURGE_KEYS_CRON },
    { name: 'dispatch-notifications', cron: '* * * * *' },
    { name: 'dispatch-emails', cron: '* * * * *' },
    {
      name: 'deactivate-stale-subscriptions',
      cron: config.JOBS_STALE_SUBSCRIPTIONS_CRON,
    },
  ];
}
