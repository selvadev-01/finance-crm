import { Injectable } from '@nestjs/common';
import { type CalendarDate, toBusinessDate } from '@repo/domain';

import { Database } from '../platform/database/database.js';
import {
  NotificationService,
  Recipients,
  rupees,
} from './notification.service.js';

const DATE = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** `14 Sep 2026` from a business date — no time zone involved. */
const dateText = (date: CalendarDate) =>
  DATE.format(new Date(`${date}T00:00:00Z`));

/** M14's scheduled jobs, as an Admin would name them. */
const JOB_NAMES: Record<string, string> = {
  'reconcile-balances': 'Nightly reconciliation',
  'flag-overdue-accounts': 'Overdue accounts',
  'purge-idempotency-keys': 'Sync key clean-up',
  'dispatch-notifications': 'Push delivery',
  'dispatch-emails': 'Email delivery',
  'deactivate-stale-subscriptions': 'Stale device clean-up',
};

/** A section flag for a template (US-074): `yes`, or empty for "no". */
const flag = (on: boolean) => (on ? 'yes' : '');

/** A count for a template section: empty when there are none. */
const countOrNone = (count: number) => (count === 0 ? '' : String(count));

/**
 * The events the rest of the system raises (M10), each with its recipients
 * in one place (decided 2026-09-14):
 *
 * - A line's collection events go to **the Senior on that line today**.
 * - Cash and integrity events also go to **Admins and Super Admins**.
 * - The person whose action caused an event is never told about it.
 *
 * The words are not here: each event names its message in the template
 * catalogue (US-074, `templates/catalogue.ts`) and hands over the values,
 * already formatted, and the business's own template — or the default — is
 * rendered per recipient in their language.
 *
 * Every method is called inside the transaction of its event. Money in the
 * values is what the recipient may already see on their own screens.
 */
@Injectable()
export class EventNotices {
  constructor(
    private readonly database: Database,
    private readonly notifications: NotificationService,
    private readonly recipients: Recipients,
  ) {}

  /** US-072: LOW / EXTRA / NO_PAYMENT to the Senior, and completion. */
  async collectionRecorded(event: {
    actorUserId: string;
    collectionId: string;
    accountLoanId: string;
    lineId: string;
    accountCode: string;
    customerName: string;
    classification: 'CORRECT' | 'LOW' | 'EXTRA' | 'NO_PAYMENT';
    amount: string;
    expectedAmount: string;
    completed: boolean;
  }): Promise<void> {
    const tx = this.database.client;
    const senior = await this.recipients.seniorOf(
      tx,
      event.lineId,
      toBusinessDate(new Date()),
    );
    const collector = await this.recipients.nameOf(tx, event.actorUserId);
    const common = {
      recipients: [senior],
      actorUserId: event.actorUserId,
      link: {
        entityType: 'collection',
        entityId: event.collectionId,
        url: `/collections/${event.collectionId}`,
      },
      values: {
        accountCode: event.accountCode,
        customerName: event.customerName,
        collector,
        amount: rupees(event.amount),
        expected: rupees(event.expectedAmount),
      },
    };

    if (event.classification === 'LOW') {
      await this.notifications.raise({ ...common, template: 'LOW_COLLECTION' });
    } else if (event.classification === 'EXTRA') {
      await this.notifications.raise({
        ...common,
        template: 'EXTRA_COLLECTION',
      });
    } else if (event.classification === 'NO_PAYMENT') {
      await this.notifications.raise({
        ...common,
        template: 'NO_PAYMENT_COLLECTION',
      });
    }
    if (event.completed) {
      await this.notifications.raise({
        recipients: [senior],
        actorUserId: event.actorUserId,
        template: 'ACCOUNT_COMPLETED',
        values: {
          accountCode: event.accountCode,
          customerName: event.customerName,
        },
        link: {
          entityType: 'account_loan',
          entityId: event.accountLoanId,
          url: `/accounts/${event.accountLoanId}`,
        },
      });
    }
  }

  /** US-044: someone other than the requester can decide it. */
  async correctionRequested(event: {
    actorUserId: string;
    organizationId: string;
    lineId: string;
    accountCode: string;
    customerName: string;
    from: string;
    to: string;
    reversal: boolean;
  }): Promise<void> {
    const tx = this.database.client;
    const senior = await this.recipients.seniorOf(
      tx,
      event.lineId,
      toBusinessDate(new Date()),
    );
    // The line's Senior decides a Junior's request; Admins decide a Senior's,
    // and are told of each other's reversals.
    const approvers =
      senior && senior !== event.actorUserId && !event.reversal
        ? [senior]
        : [senior, ...(await this.recipients.admins(tx, event.organizationId))];
    const requester = await this.recipients.nameOf(tx, event.actorUserId);
    await this.notifications.raise({
      recipients: approvers,
      actorUserId: event.actorUserId,
      template: event.reversal ? 'REVERSAL_REQUESTED' : 'CORRECTION_REQUESTED',
      values: {
        accountCode: event.accountCode,
        customerName: event.customerName,
        requester,
        from: rupees(event.from),
        to: rupees(event.to),
      },
      link: {
        entityType: 'collection_approval',
        entityId: null,
        url: '/collections/pending-approval',
      },
    });
  }

  /**
   * ADR-0018: a field expense waits for someone other than its spender. A
   * Junior's goes to the line's Senior and the Admins; a Senior's own to the
   * Admins only — the same people the API lets decide it.
   */
  async expenseRequested(event: {
    actorUserId: string;
    organizationId: string;
    lineId: string;
    lineName: string;
    hop: 'JUNIOR_TO_SENIOR' | 'SENIOR_TO_OFFICE';
    category: string;
    amount: string;
    note: string;
  }): Promise<void> {
    const tx = this.database.client;
    const admins = await this.recipients.admins(tx, event.organizationId);
    const senior =
      event.hop === 'JUNIOR_TO_SENIOR'
        ? await this.recipients.seniorOf(
            tx,
            event.lineId,
            toBusinessDate(new Date()),
          )
        : null;
    const spender = await this.recipients.nameOf(tx, event.actorUserId);
    await this.notifications.raise({
      recipients: [senior, ...admins],
      actorUserId: event.actorUserId,
      template: 'EXPENSE_REQUESTED',
      values: {
        lineName: event.lineName,
        spender,
        amount: rupees(event.amount),
        expenseType: event.category.toLowerCase(),
        note: event.note,
      },
      link: {
        entityType: 'expense',
        entityId: null,
        url: '/cash#field-expenses',
      },
    });
  }

  /** ADR-0018: the spender hears the decision, and a rejection's reason. */
  async expenseDecided(event: {
    actorUserId: string;
    spenderUserId: string;
    expenseId: string;
    approved: boolean;
    category: string;
    amount: string;
    note: string | null;
  }): Promise<void> {
    const tx = this.database.client;
    const by = await this.recipients.nameOf(tx, event.actorUserId);
    await this.notifications.raise({
      recipients: [event.spenderUserId],
      actorUserId: event.actorUserId,
      template: event.approved ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED',
      values: {
        amount: rupees(event.amount),
        decidedBy: by,
        expenseType: event.category.toLowerCase(),
        reason: event.note ?? '',
      },
      link: {
        entityType: 'expense',
        entityId: event.expenseId,
        url: '/route#expense',
      },
    });
  }

  /**
   * US-020 (§12 "new customer"): the Senior of the line the customer joins
   * hears that someone new is on their round. The Admin who onboarded them
   * is not told of their own action.
   */
  async customerOnboarded(event: {
    actorUserId: string;
    customerId: string;
    customerCode: string;
    customerName: string;
    lineId: string;
    lineName: string;
  }): Promise<void> {
    const tx = this.database.client;
    const senior = await this.recipients.seniorOf(
      tx,
      event.lineId,
      toBusinessDate(new Date()),
    );
    const by = await this.recipients.nameOf(tx, event.actorUserId);
    await this.notifications.raise({
      recipients: [senior],
      actorUserId: event.actorUserId,
      template: 'NEW_CUSTOMER',
      values: {
        lineName: event.lineName,
        customerName: event.customerName,
        customerCode: event.customerCode,
        onboardedBy: by,
      },
      link: {
        entityType: 'customer',
        entityId: event.customerId,
        url: `/customers/${event.customerId}`,
      },
    });
  }

  /**
   * US-032 (decided 2026-09-24): a disbursed account is a new visit on the
   * round, so the Senior of the customer's line today hears what to collect
   * and from when. A mid-term account (US-030a) joins the round the same way
   * and says so. The Admin who disbursed is not told of their own action.
   */
  async accountDisbursed(event: {
    actorUserId: string;
    accountLoanId: string;
    accountCode: string;
    customerName: string;
    lineId: string;
    dailyAmount: string;
    collectionFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    firstDueDate: CalendarDate;
    midTerm: boolean;
  }): Promise<void> {
    const tx = this.database.client;
    const senior = await this.recipients.seniorOf(
      tx,
      event.lineId,
      toBusinessDate(new Date()),
    );
    const by = await this.recipients.nameOf(tx, event.actorUserId);
    await this.notifications.raise({
      recipients: [senior],
      actorUserId: event.actorUserId,
      template: event.midTerm ? 'RUNNING_ACCOUNT_ADDED' : 'ACCOUNT_DISBURSED',
      values: {
        accountCode: event.accountCode,
        customerName: event.customerName,
        disbursedBy: by,
        amount: rupees(event.dailyAmount),
        daily: flag(event.collectionFrequency === 'DAILY'),
        weekly: flag(event.collectionFrequency === 'WEEKLY'),
        monthly: flag(event.collectionFrequency === 'MONTHLY'),
        startDate: dateText(event.firstDueDate),
      },
      link: {
        entityType: 'account_loan',
        entityId: event.accountLoanId,
        url: `/accounts/${event.accountLoanId}`,
      },
    });
  }

  /**
   * A Senior opened an account that waits for approval (decided 2026-10-03):
   * every Admin and the Super Admin hear, since any of them may approve it.
   */
  async accountAwaitingApproval(event: {
    actorUserId: string;
    organizationId: string;
    accountLoanId: string;
    accountCode: string;
    customerName: string;
    lineName: string;
    accountAmount: string;
  }): Promise<void> {
    const tx = this.database.client;
    const admins = await this.recipients.admins(tx, event.organizationId);
    const openedBy = await this.recipients.nameOf(tx, event.actorUserId);
    await this.notifications.raise({
      recipients: admins,
      actorUserId: event.actorUserId,
      template: 'ACCOUNT_APPROVAL_REQUESTED',
      values: {
        lineName: event.lineName,
        customerName: event.customerName,
        accountCode: event.accountCode,
        openedBy,
        amount: rupees(event.accountAmount),
      },
      link: {
        entityType: 'account_loan',
        entityId: event.accountLoanId,
        url: `/accounts/${event.accountLoanId}`,
      },
    });
  }

  /** The Senior who opened an account hears it was approved (decided 2026-10-03). */
  async accountApproved(event: {
    actorUserId: string;
    openedByUserId: string | null;
    accountLoanId: string;
    accountCode: string;
    customerName: string;
  }): Promise<void> {
    if (!event.openedByUserId) return;
    const tx = this.database.client;
    const approvedBy = await this.recipients.nameOf(tx, event.actorUserId);
    await this.notifications.raise({
      recipients: [event.openedByUserId],
      actorUserId: event.actorUserId,
      template: 'ACCOUNT_APPROVED',
      values: {
        customerName: event.customerName,
        accountCode: event.accountCode,
        approvedBy,
      },
      link: {
        entityType: 'account_loan',
        entityId: event.accountLoanId,
        url: `/accounts/${event.accountLoanId}`,
      },
    });
  }

  /**
   * M03: the person assigned, and the line's Senior today. Being assigned
   * here takes them off no other line (decided 2026-10-03), so no other
   * line's Senior has anything to hear.
   */
  async assignmentMade(event: {
    actorUserId: string;
    staffUserId: string;
    role: 'SENIOR' | 'JUNIOR';
    lineId: string;
    lineName: string;
    effectiveFrom: CalendarDate;
  }): Promise<void> {
    const tx = this.database.client;
    const today = toBusinessDate(new Date());
    const seniors = [await this.recipients.seniorOf(tx, event.lineId, today)];
    const name = await this.recipients.nameOf(tx, event.staffUserId);
    await this.notifications.raise({
      recipients: [event.staffUserId, ...seniors],
      actorUserId: event.actorUserId,
      template: 'NEW_ASSIGNMENT',
      values: {
        lineName: event.lineName,
        staffName: name,
        senior: flag(event.role === 'SENIOR'),
        startDate: dateText(event.effectiveFrom),
      },
      link: {
        entityType: 'line',
        entityId: event.lineId,
        url: `/lines/${event.lineId}`,
      },
    });
  }

  /** US-043: one summary per close, not one alert per customer (decided 2026-09-14). */
  async dayClosedWithMissed(event: {
    actorUserId: string;
    lineId: string;
    lineName: string;
    businessDate: CalendarDate;
    missed: number;
  }): Promise<void> {
    if (event.missed === 0) return;
    const tx = this.database.client;
    const senior = await this.recipients.seniorOf(
      tx,
      event.lineId,
      toBusinessDate(new Date()),
    );
    await this.notifications.raise({
      recipients: [senior],
      actorUserId: event.actorUserId,
      template: 'MISSED_COLLECTION',
      values: {
        lineName: event.lineName,
        date: dateText(event.businessDate),
        count: String(event.missed),
        one: flag(event.missed === 1),
      },
      link: dayLink(event.lineId, event.businessDate),
    });
  }

  /** BR-16a: the Senior must re-tally, and is told so rather than left to notice. */
  async dayReopened(event: {
    actorUserId: string | null;
    lineId: string;
    lineName: string;
    businessDate: CalendarDate;
  }): Promise<void> {
    const tx = this.database.client;
    const senior = await this.recipients.seniorOf(
      tx,
      event.lineId,
      toBusinessDate(new Date()),
    );
    await this.notifications.raise({
      recipients: [senior],
      actorUserId: event.actorUserId,
      template: 'DAY_REOPENED',
      values: {
        lineName: event.lineName,
        date: dateText(event.businessDate),
      },
      link: dayLink(event.lineId, event.businessDate),
    });
  }

  /** S-06: the receiver is told a count is waiting for them. */
  async handoverSubmitted(event: {
    actorUserId: string;
    toUserId: string;
    lineName: string;
    businessDate: CalendarDate;
    declaredAmount: string;
    discrepancy: string;
  }): Promise<void> {
    const sender = await this.recipients.nameOf(
      this.database.client,
      event.actorUserId,
    );
    const differs = event.discrepancy !== '0.00';
    await this.notifications.raise({
      recipients: [event.toUserId],
      actorUserId: event.actorUserId,
      template: 'HANDOVER_SUBMITTED',
      values: {
        lineName: event.lineName,
        date: dateText(event.businessDate),
        sender,
        amount: rupees(event.declaredAmount),
        difference: differs ? rupees(event.discrepancy) : '',
      },
      link: { entityType: 'cash_handover', entityId: null, url: '/cash' },
    });
  }

  /**
   * US-062: the cash is settled, so the person who handed it over is told.
   * The receiver acted, and is never notified of their own action.
   */
  async handoverAcknowledged(event: {
    actorUserId: string;
    fromUserId: string;
    lineName: string;
    businessDate: CalendarDate;
    countedAmount: string;
    discrepancy: string;
  }): Promise<void> {
    const receiver = await this.recipients.nameOf(
      this.database.client,
      event.actorUserId,
    );
    const differs = event.discrepancy !== '0.00';
    await this.notifications.raise({
      recipients: [event.fromUserId],
      actorUserId: event.actorUserId,
      // A difference is already an ALERT of its own to the Senior and Admins
      // (`handoverDiscrepancy`); this one tells the sender their cash arrived.
      template: differs
        ? 'HANDOVER_ACKNOWLEDGED_DIFFERENT'
        : 'HANDOVER_ACKNOWLEDGED',
      values: {
        lineName: event.lineName,
        date: dateText(event.businessDate),
        receiver,
        counted: rupees(event.countedAmount),
        difference: differs ? rupees(event.discrepancy) : '',
      },
      link: { entityType: 'cash_handover', entityId: null, url: '/cash' },
    });
  }

  /** US-063: a dispute escalates to Admin, and the other party hears of it. */
  async handoverDisputed(event: {
    actorUserId: string;
    organizationId: string;
    fromUserId: string;
    toUserId: string;
    lineName: string;
    businessDate: CalendarDate;
    declaredAmount: string;
    note: string;
  }): Promise<void> {
    const tx = this.database.client;
    const who = await this.recipients.nameOf(tx, event.actorUserId);
    await this.notifications.raise({
      recipients: [
        event.fromUserId,
        event.toUserId,
        ...(await this.recipients.admins(tx, event.organizationId)),
      ],
      actorUserId: event.actorUserId,
      template: 'HANDOVER_DISPUTED',
      values: {
        lineName: event.lineName,
        date: dateText(event.businessDate),
        disputedBy: who,
        amount: rupees(event.declaredAmount),
        note: event.note,
      },
      link: { entityType: 'cash_handover', entityId: null, url: '/cash' },
    });
  }

  /** S-05: cash acknowledged with a difference from the record. */
  async handoverDiscrepancy(event: {
    actorUserId: string;
    organizationId: string;
    lineId: string;
    lineName: string;
    businessDate: CalendarDate;
    discrepancy: string;
  }): Promise<void> {
    if (event.discrepancy === '0.00') return;
    const tx = this.database.client;
    const senior = await this.recipients.seniorOf(
      tx,
      event.lineId,
      toBusinessDate(new Date()),
    );
    const short = event.discrepancy.startsWith('-');
    await this.notifications.raise({
      recipients: [
        senior,
        ...(await this.recipients.admins(tx, event.organizationId)),
      ],
      actorUserId: event.actorUserId,
      template: short ? 'CASH_SHORT' : 'CASH_OVER',
      values: {
        lineName: event.lineName,
        date: dateText(event.businessDate),
        difference: rupees(event.discrepancy.replace('-', '')),
      },
      link: dayLink(event.lineId, event.businessDate),
    });
  }

  /**
   * M06 / US-093: a holiday declared or removed changes the routes of the
   * lines it covers, so their Seniors and Juniors are told — a WARNING, so it
   * is pushed. Juniors are linked to their route, Seniors to the holiday list.
   */
  async holidayChanged(event: {
    actorUserId: string;
    organizationId: string;
    sectorId: string | null;
    sectorName: string | null;
    date: CalendarDate;
    name: string;
    change: 'DECLARED' | 'REMOVED';
  }): Promise<void> {
    const tx = this.database.client;
    const staff = await this.recipients.lineStaff(
      tx,
      event.organizationId,
      event.sectorId,
      toBusinessDate(new Date()),
    );
    const words = {
      template:
        event.change === 'DECLARED'
          ? ('HOLIDAY_DECLARED' as const)
          : ('HOLIDAY_REMOVED' as const),
      values: {
        holidayName: event.name,
        date: dateText(event.date),
        sectorName: event.sectorName ?? '',
      },
      actorUserId: event.actorUserId,
    };
    await this.notifications.raise({
      ...words,
      recipients: staff.seniors,
      link: {
        entityType: 'holiday',
        entityId: null,
        url: '/settings/holidays',
      },
    });
    await this.notifications.raise({
      ...words,
      recipients: staff.juniors,
      link: { entityType: 'holiday', entityId: null, url: '/route' },
    });
  }

  /**
   * BR-05 / US-033: accounts that went past their target date with money
   * still owed, found by the nightly job (M14). One summary per line, not one
   * per account — a hundred ageing accounts is one thing to look at, and the
   * overdue report (US-087) is where the list lives.
   *
   * A `WARNING`, not an `ALERT` (decided 2026-09-20): going overdue is
   * expected on a slow account, and the loud events stay the low and
   * no-payment visits of a single day.
   */
  async accountsOverdue(event: {
    lineId: string;
    count: number;
    today: CalendarDate;
  }): Promise<void> {
    if (event.count === 0) return;
    const senior = await this.recipients.seniorOf(
      this.database.client,
      event.lineId,
      event.today,
    );
    await this.notifications.raise({
      recipients: [senior],
      template: 'ACCOUNT_OVERDUE',
      values: { count: String(event.count), one: flag(event.count === 1) },
      link: {
        entityType: 'account_loan',
        entityId: null,
        url: `/reports/overdue?line=${event.lineId}`,
      },
    });
  }

  /**
   * M14: a scheduled job for this organization failed five times and was
   * dead-lettered. An ALERT to Admins and Super Admins — what it stops (a
   * night's reconciliation, overdue flags, push delivery) is silent otherwise.
   * There is no job screen yet (M14), so it links home.
   */
  async jobFailed(event: {
    organizationId: string;
    job: string;
    lastError: string | null;
  }): Promise<void> {
    await this.notifications.raise({
      recipients: await this.recipients.admins(
        this.database.client,
        event.organizationId,
      ),
      template: 'JOB_FAILED',
      values: {
        jobName: JOB_NAMES[event.job] ?? event.job,
        lastError: event.lastError?.slice(0, 200) ?? '',
      },
      link: { entityType: 'job', entityId: null, url: '/home' },
    });
  }

  /** US-095: every mismatch is an ALERT to Admins and Super Admins. */
  async reconciliationMismatch(event: {
    organizationId: string;
    rebuilt: number;
    accountMismatches: number;
    unearned: boolean;
  }): Promise<void> {
    if (!event.rebuilt && !event.accountMismatches && !event.unearned) return;
    const tx = this.database.client;
    await this.notifications.raise({
      recipients: await this.recipients.admins(tx, event.organizationId),
      template: 'RECONCILIATION_MISMATCH',
      values: {
        rebuilt: countOrNone(event.rebuilt),
        rebuiltOne: flag(event.rebuilt === 1),
        accountMismatches: countOrNone(event.accountMismatches),
        accountMismatchOne: flag(event.accountMismatches === 1),
        unearned: flag(event.unearned),
      },
      link: { entityType: 'audit_log', entityId: null, url: '/settings/audit' },
    });
  }
}

function dayLink(lineId: string, businessDate: CalendarDate) {
  return {
    entityType: 'day_close',
    entityId: null,
    url: `/lines/${lineId}/day-closes/${businessDate}`,
  };
}
