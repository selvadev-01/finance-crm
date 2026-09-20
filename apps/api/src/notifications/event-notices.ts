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

/**
 * The events the rest of the system raises (M10), each with its recipients,
 * category and words in one place (decided 2026-09-14):
 *
 * - A line's collection events go to **the Senior on that line today**.
 * - Cash and integrity events also go to **Admins and Super Admins**.
 * - The person whose action caused an event is never told about it.
 *
 * Every method is called inside the transaction of its event. Money in the
 * text is what the recipient may already see on their own screens.
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
    const link = {
      entityType: 'collection',
      entityId: event.collectionId,
      url: `/collections/${event.collectionId}`,
    };
    const common = {
      recipients: [senior],
      actorUserId: event.actorUserId,
      link,
    };

    if (event.classification === 'LOW') {
      await this.notifications.raise({
        ...common,
        category: 'ALERT',
        eventType: 'LOW_COLLECTION',
        title: `Low collection · ${event.accountCode}`,
        body: `${collector} collected ${rupees(event.amount)} of ${rupees(event.expectedAmount)} from ${event.customerName}`,
      });
    } else if (event.classification === 'EXTRA') {
      await this.notifications.raise({
        ...common,
        category: 'WARNING',
        eventType: 'EXTRA_COLLECTION',
        title: `Extra collection · ${event.accountCode}`,
        body: `${collector} collected ${rupees(event.amount)} against ${rupees(event.expectedAmount)} from ${event.customerName}`,
      });
    } else if (event.classification === 'NO_PAYMENT') {
      await this.notifications.raise({
        ...common,
        category: 'ALERT',
        eventType: 'NO_PAYMENT_COLLECTION',
        title: `No payment · ${event.accountCode}`,
        body: `${collector} visited ${event.customerName}, who paid nothing (${rupees(event.expectedAmount)} was due)`,
      });
    }
    if (event.completed) {
      await this.notifications.raise({
        recipients: [senior],
        actorUserId: event.actorUserId,
        category: 'SUCCESS',
        eventType: 'ACCOUNT_COMPLETED',
        title: `Account completed · ${event.accountCode}`,
        body: `${event.customerName} has paid the account in full`,
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
      category: 'WARNING',
      eventType: 'APPROVAL_REQUESTED',
      title: `${event.reversal ? 'Reversal' : 'Correction'} to approve · ${event.accountCode}`,
      body: `${requester} asks to change ${event.customerName}'s collection from ${rupees(event.from)} to ${rupees(event.to)}`,
      link: {
        entityType: 'collection_approval',
        entityId: null,
        url: '/collections/pending-approval',
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
      category: 'INFORMATION',
      eventType: 'NEW_CUSTOMER',
      title: `New customer · ${event.lineName}`,
      body: `${by} onboarded ${event.customerName} (${event.customerCode}) onto ${event.lineName}`,
      link: {
        entityType: 'customer',
        entityId: event.customerId,
        url: `/customers/${event.customerId}`,
      },
    });
  }

  /** M03: the person assigned, and the Seniors of the lines involved. */
  async assignmentMade(event: {
    actorUserId: string;
    staffUserId: string;
    role: 'SENIOR' | 'JUNIOR';
    lineId: string;
    lineName: string;
    effectiveFrom: CalendarDate;
    previousLineIds: string[];
  }): Promise<void> {
    const tx = this.database.client;
    const today = toBusinessDate(new Date());
    const seniors = await Promise.all(
      [event.lineId, ...event.previousLineIds].map((lineId) =>
        this.recipients.seniorOf(tx, lineId, today),
      ),
    );
    const name = await this.recipients.nameOf(tx, event.staffUserId);
    await this.notifications.raise({
      recipients: [event.staffUserId, ...seniors],
      actorUserId: event.actorUserId,
      category: 'INFORMATION',
      eventType: 'NEW_ASSIGNMENT',
      title: `New assignment · ${event.lineName}`,
      body: `${name} is ${event.role === 'SENIOR' ? 'Senior' : 'a Junior'} on ${event.lineName} from ${dateText(event.effectiveFrom)}`,
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
      category: 'ALERT',
      eventType: 'MISSED_COLLECTION',
      title: `Missed collections · ${event.lineName}`,
      body: `${event.missed} ${event.missed === 1 ? 'customer was' : 'customers were'} not visited on ${dateText(event.businessDate)}`,
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
      category: 'WARNING',
      eventType: 'DAY_REOPENED',
      title: `Day reopened · ${event.lineName}`,
      body: `A collection for ${dateText(event.businessDate)} arrived after the day was closed. Close it again to re-tally.`,
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
      category: 'INFORMATION',
      eventType: 'HANDOVER_SUBMITTED',
      title: `Cash to acknowledge · ${event.lineName}`,
      body: `${sender} handed over ${rupees(event.declaredAmount)} for ${dateText(event.businessDate)}${differs ? ` (${rupees(event.discrepancy)} against the record)` : ''}`,
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
      category: differs ? 'WARNING' : 'SUCCESS',
      eventType: 'HANDOVER_ACKNOWLEDGED',
      title: `Cash received · ${event.lineName}`,
      body: `${receiver} counted ${rupees(event.countedAmount)} for ${dateText(event.businessDate)}${differs ? `, ${rupees(event.discrepancy)} against what you declared` : ''}`,
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
      category: 'ALERT',
      eventType: 'HANDOVER_DISPUTED',
      title: `Handover disputed · ${event.lineName}`,
      body: `${who} disputed ${rupees(event.declaredAmount)} for ${dateText(event.businessDate)}: ${event.note}`,
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
      category: 'ALERT',
      eventType: 'DAY_CLOSE_DISCREPANCY',
      title: `Cash ${short ? 'short' : 'over'} · ${event.lineName}`,
      body: `Cash for ${dateText(event.businessDate)} was acknowledged ${rupees(event.discrepancy.replace('-', ''))} ${short ? 'short of' : 'over'} the record`,
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
    const where = event.sectorName ? ` in ${event.sectorName}` : '';
    const day = dateText(event.date);
    const declared = event.change === 'DECLARED';
    const words = {
      category: 'WARNING' as const,
      eventType: declared
        ? ('HOLIDAY_DECLARED' as const)
        : ('HOLIDAY_REMOVED' as const),
      title: `${declared ? 'Holiday declared' : 'Holiday removed'} · ${day}`,
      body: declared
        ? `${event.name}: no collections on ${day}${where}. Collections due that day and after move to the next working day.`
        : `${event.name} on ${day}${where} is a working day again. Collections after it move a day earlier.`,
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

  /** US-095: every mismatch is an ALERT to Admins and Super Admins. */
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
      category: 'WARNING',
      eventType: 'ACCOUNT_OVERDUE',
      title: `${event.count === 1 ? 'An account is' : `${event.count} accounts are`} overdue`,
      body: `${event.count === 1 ? 'It has' : 'They have'} passed the target completion date with money still owed.`,
      link: {
        entityType: 'account_loan',
        entityId: null,
        url: `/reports/overdue?line=${event.lineId}`,
      },
    });
  }

  async reconciliationMismatch(event: {
    organizationId: string;
    rebuilt: number;
    accountMismatches: number;
    unearned: boolean;
  }): Promise<void> {
    const parts = [
      event.rebuilt
        ? `${event.rebuilt} ledger ${event.rebuilt === 1 ? 'balance' : 'balances'} rebuilt`
        : null,
      event.accountMismatches
        ? `${event.accountMismatches} ${event.accountMismatches === 1 ? 'account disagrees' : 'accounts disagree'} with the ledger`
        : null,
      event.unearned ? 'unearned profit disagrees with the accounts' : null,
    ].filter(Boolean);
    if (parts.length === 0) return;
    const tx = this.database.client;
    await this.notifications.raise({
      recipients: await this.recipients.admins(tx, event.organizationId),
      category: 'ALERT',
      eventType: 'RECONCILIATION_MISMATCH',
      title: 'Nightly reconciliation found a mismatch',
      body: `${parts.join('; ')}. Details are in the audit log.`,
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
