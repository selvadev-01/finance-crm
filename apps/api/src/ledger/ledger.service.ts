import { Injectable } from '@nestjs/common';
import type { LedgerAccountType } from '@repo/db';
import { type CalendarDate, toMoney, toUtcMidnight } from '@repo/domain';
import { randomUUID } from 'node:crypto';

import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { InternalError } from '../platform/errors/errors.js';

/** The business-wide ledger accounts, one of each per organization. */
export type OrganizationAccountType =
  'CASH_AT_OFFICE' | 'CAPITAL' | 'UNEARNED_PROFIT' | 'EARNED_PROFIT';

const NORMAL_BALANCE: Record<LedgerAccountType, 'DEBIT' | 'CREDIT'> = {
  CASH_IN_HAND: 'DEBIT',
  CASH_AT_OFFICE: 'DEBIT',
  LOAN_RECEIVABLE: 'DEBIT',
  CAPITAL: 'CREDIT',
  UNEARNED_PROFIT: 'CREDIT',
  EARNED_PROFIT: 'CREDIT',
};

export interface PostingLine {
  ledgerAccountId: string;
  direction: 'DEBIT' | 'CREDIT';
  /** A decimal string, `> 0`. A zero line is dropped; a negative one is refused. */
  amount: string;
}

export interface Posting {
  transactionType:
    'DISBURSEMENT' | 'COLLECTION' | 'HANDOVER' | 'ADJUSTMENT' | 'WRITE_OFF';
  source: { table: string; id: string };
  businessDate: CalendarDate;
  eventAt: Date;
  description: string;
  lines: PostingLine[];
}

/**
 * M09 Ledger — the only writer of ledger rows, and system-only: no endpoint
 * posts a transaction (M09 operations). Callers are money writes in other
 * modules, which call it **inside their own `Database.transaction`** so the
 * posting commits or rolls back with the state change it describes (BR-18).
 *
 * Balancing is not checked here. The deferred constraint trigger checks it at
 * COMMIT (ADR-0006), which a service check could only duplicate — and a
 * duplicate is the kind a hurried change deletes.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly database: Database) {}

  /**
   * The organization's business-wide account of `type`, created on first use.
   * `INSERT … ON CONFLICT DO NOTHING` against the one-per-organization partial
   * index, so two first uses at once both succeed and neither aborts the
   * surrounding transaction.
   */
  async organizationAccount(
    organizationId: string,
    type: OrganizationAccountType,
  ): Promise<string> {
    const tx = this.database.client;
    await tx.$executeRaw`
      INSERT INTO ledger_account (id, "organizationId", "accountType", "normalBalance")
      VALUES (${randomUUID()}, ${organizationId},
              ${type}::"LedgerAccountType", ${NORMAL_BALANCE[type]}::"Direction")
      ON CONFLICT ("organizationId", "accountType")
        WHERE "accountType" = ANY (ARRAY['CASH_AT_OFFICE'::"LedgerAccountType", 'CAPITAL'::"LedgerAccountType", 'UNEARNED_PROFIT'::"LedgerAccountType", 'EARNED_PROFIT'::"LedgerAccountType"])
      DO NOTHING`;
    const account = await tx.ledgerAccount.findFirstOrThrow({
      where: { organizationId, accountType: type },
      select: { id: true },
    });
    return account.id;
  }

  /**
   * A staff member's `CASH_IN_HAND`, created on first use — conflict-safe
   * against `ledger_account_cash_in_hand_owner_key` like `organizationAccount`.
   */
  async cashInHand(organizationId: string, userId: string): Promise<string> {
    const tx = this.database.client;
    await tx.$executeRaw`
      INSERT INTO ledger_account (id, "organizationId", "accountType", "ownerUserId", "normalBalance")
      VALUES (${randomUUID()}, ${organizationId}, 'CASH_IN_HAND'::"LedgerAccountType",
              ${userId}, 'DEBIT'::"Direction")
      ON CONFLICT ("ownerUserId") WHERE "accountType" = 'CASH_IN_HAND'::"LedgerAccountType"
      DO NOTHING`;
    const account = await tx.ledgerAccount.findFirstOrThrow({
      where: { accountType: 'CASH_IN_HAND', ownerUserId: userId },
      select: { id: true },
    });
    return account.id;
  }

  /** An account's `LOAN_RECEIVABLE`, which disbursement created. */
  async receivableFor(accountLoanId: string): Promise<string> {
    const account = await this.database.client.ledgerAccount.findFirst({
      where: { accountType: 'LOAN_RECEIVABLE', accountLoanId },
      select: { id: true },
    });
    if (!account) {
      throw new InternalError(
        'RECEIVABLE_MISSING',
        `Account ${accountLoanId} is active but has no receivable; it was not disbursed through Rasi`,
      );
    }
    return account.id;
  }

  /** The `LOAN_RECEIVABLE` for an account — created with it (M09). */
  async createReceivable(
    organizationId: string,
    accountLoanId: string,
  ): Promise<string> {
    const account = await this.database.client.ledgerAccount.create({
      data: {
        organizationId,
        accountType: 'LOAN_RECEIVABLE',
        accountLoanId,
        normalBalance: 'DEBIT',
      },
      select: { id: true },
    });
    return account.id;
  }

  /**
   * Writes one balanced transaction and moves each account's cached balance,
   * signed by its normal balance — the same rule the nightly reconciliation
   * recomputes from entries (M14).
   */
  async post(context: RequestContext, posting: Posting): Promise<string> {
    if (!this.database.inTransaction) {
      throw new InternalError(
        'LEDGER_OUTSIDE_TRANSACTION',
        `Ledger posting for ${posting.source.table} written outside a transaction`,
      );
    }
    const tx = this.database.client;
    const lines = posting.lines.filter(
      (line) => !toMoney(line.amount).isZero(),
    );
    for (const line of lines) {
      if (toMoney(line.amount).isNegative()) {
        throw new InternalError(
          'LEDGER_NEGATIVE_AMOUNT',
          'A ledger line amount must be positive; the direction carries the sign',
        );
      }
    }

    const accounts = await tx.ledgerAccount.findMany({
      where: {
        id: { in: [...new Set(lines.map((line) => line.ledgerAccountId))] },
      },
      select: { id: true, normalBalance: true },
    });
    const normal = new Map(
      accounts.map((account) => [account.id, account.normalBalance]),
    );

    const transaction = await tx.ledgerTransaction.create({
      data: {
        transactionType: posting.transactionType,
        sourceTable: posting.source.table,
        sourceId: posting.source.id,
        businessDate: toUtcMidnight(posting.businessDate),
        eventAt: posting.eventAt,
        description: posting.description,
        createdByUserId: context.userId,
        entries: {
          create: lines.map((line, index) => ({
            ledgerAccountId: line.ledgerAccountId,
            direction: line.direction,
            amount: line.amount,
            sequence: index + 1,
          })),
        },
      },
      select: { id: true },
    });

    for (const line of lines) {
      const signed =
        line.direction === normal.get(line.ledgerAccountId)
          ? toMoney(line.amount)
          : toMoney(line.amount).negated();
      await tx.ledgerAccount.update({
        where: { id: line.ledgerAccountId },
        data: { balance: { increment: signed.toString() } },
      });
    }
    return transaction.id;
  }
}
