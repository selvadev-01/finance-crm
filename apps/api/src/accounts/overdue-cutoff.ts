import { addCalendarDays, type CalendarDate } from '@repo/domain';

/**
 * BR-05's one definition of overdue: an account is behind only once its target
 * completion date falls **before** this date.
 *
 * `account.overdueGraceDays` (M15, US-094) shifts the line back by that many
 * calendar days; zero — the default, and open question 3's answer — leaves it
 * at today, so an account is overdue the day after its target.
 *
 * Every live computation of "overdue" reads the setting and calls this:
 * the nightly `isOverdue` flag (`accounts/overdue.service.ts`), the overdue
 * report (`reports/overdue-report.service.ts`, M12) and the Senior line
 * dashboard (`dashboards/line-dashboard.service.ts`, M11). One definition, so
 * a non-zero grace cannot make the three disagree.
 */
export function overdueCutoff(
  today: CalendarDate,
  graceDays: number,
): CalendarDate {
  return graceDays === 0 ? today : addCalendarDays(today, -graceDays);
}
