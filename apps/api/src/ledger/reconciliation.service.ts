import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Prisma } from '@repo/db';
import { toMoney, unearnedProfit } from '@repo/domain';

import { AuditWriter } from '../audit/audit.writer.js';
import { EventNotices } from '../notifications/event-notices.js';
import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';

type Tx = Prisma.TransactionClient;
type Decimal = ReturnType<typeof toMoney>;

export interface ReconciliationReport {
  organizationId: string;
  ledgerAccountsChecked: number;
  /** Cached balances that disagreed with their entries, and were rebuilt. */
  rebuilt: {
    ledgerAccountId: string;
    accountType: string;
    cached: string;
    fromEntries: string;
  }[];
  /** Accounts whose cached collected figure disagrees with the ledger. Not changed. */
  accountMismatches: {
    accountLoanId: string;
    accountCode: string;
    collectedAmount: string;
    outstandingAmount: string;
    collectedFromLedger: string;
  }[];
  /** UNEARNED_PROFIT against Σ the unearned profit each account should still hold. */
  unearnedMismatch: { ledger: string; expected: string } | null;
}

/**
 * US-095 — the nightly safety net under every denormalised figure (M09, M14).
 * For one organization:
 *
 * 1. **Every ledger account's cached `balance` is recomputed** from its
 *    immutable entries, signed by its normal balance. A mismatch is re-checked
 *    under the row lock — a posting may have landed between the read and the
 *    check — and the cache is rebuilt, audited with before and after.
 * 2. **Every disbursed account's `collectedAmount` is compared with the
 *    ledger**: its receivable holds `A − collected`, so the ledger's collected
 *    figure is `A − receivable`. A mismatch is re-checked under the account
 *    lock and **reported, not changed** — an account's balance drives its
 *    schedule and completion, and correcting it silently would hide the bug
 *    that caused it.
 * 3. **`UNEARNED_PROFIT` is compared** with Σ `unearnedProfit` over the
 *    accounts, from the ledger's collected figures (BR-18).
 *
 * Every mismatch is written to the audit log as a system action and logged at
 * error level, and one ALERT goes to the organization's Admins and Super
 * Admins (M10). Idempotent: a second run finds nothing to rebuild.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly logger: PinoLogger,
    private readonly notices: EventNotices,
  ) {}

  async reconcile(system: SystemContext): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      organizationId: system.organizationId,
      ledgerAccountsChecked: 0,
      rebuilt: [],
      accountMismatches: [],
      unearnedMismatch: null,
    };

    // 1. Ledger balance caches.
    const accounts = await this.database.client.ledgerAccount.findMany({
      where: { organizationId: system.organizationId },
      select: {
        id: true,
        accountType: true,
        normalBalance: true,
        balance: true,
        accountLoanId: true,
      },
    });
    report.ledgerAccountsChecked = accounts.length;
    const fromEntries = await this.balancesFromEntries(
      this.database.client,
      system.organizationId,
    );
    for (const account of accounts) {
      const computed = fromEntries.get(account.id) ?? toMoney('0');
      if (computed.equals(account.balance.toString())) continue;
      const rebuilt = await this.database.transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM ledger_account WHERE id = ${account.id} FOR UPDATE`;
        const locked = await tx.ledgerAccount.findUniqueOrThrow({
          where: { id: account.id },
          select: { balance: true, normalBalance: true },
        });
        const now = await this.balanceOf(tx, account.id, locked.normalBalance);
        if (now.equals(locked.balance.toString())) return null;
        await tx.ledgerAccount.update({
          where: { id: account.id },
          data: { balance: now.toFixed(2) },
        });
        await this.audit.recordSystem(system, {
          action: 'UPDATE',
          entityTable: 'ledger_account',
          entityId: account.id,
          before: { balance: toMoney(locked.balance.toString()).toFixed(2) },
          after: {
            balance: now.toFixed(2),
            reconciliation: 'balance rebuilt from entries',
          },
        });
        return {
          cached: toMoney(locked.balance.toString()).toFixed(2),
          fromEntries: now.toFixed(2),
        };
      });
      if (rebuilt) {
        report.rebuilt.push({
          ledgerAccountId: account.id,
          accountType: account.accountType,
          ...rebuilt,
        });
        this.logger.error(
          {
            organizationId: system.organizationId,
            ledgerAccountId: account.id,
            runId: system.runId,
          },
          'Ledger balance cache disagreed with its entries and was rebuilt',
        );
      }
    }

    // 2. Account collected figures, and 3. unearned profit, from the ledger.
    const receivables = accounts.filter(
      (account) =>
        account.accountType === 'LOAN_RECEIVABLE' && account.accountLoanId,
    );
    const loans = await this.database.client.accountLoan.findMany({
      where: {
        organizationId: system.organizationId,
        id: { in: receivables.map((r) => r.accountLoanId!) },
      },
      select: {
        id: true,
        accountCode: true,
        accountAmount: true,
        profitAmount: true,
        collectedAmount: true,
        outstandingAmount: true,
      },
    });
    const receivableOf = new Map(
      receivables.map((r) => [r.accountLoanId!, r.id]),
    );
    let expectedUnearned = toMoney('0');

    for (const loan of loans) {
      const receivable =
        fromEntries.get(receivableOf.get(loan.id)!) ?? toMoney('0');
      const collectedFromLedger = toMoney(loan.accountAmount.toString()).minus(
        receivable,
      );
      expectedUnearned = expectedUnearned.plus(
        unearnedProfit({
          accountAmount: loan.accountAmount.toString(),
          profitAmount: loan.profitAmount.toString(),
          collected: clamp(collectedFromLedger, loan.accountAmount.toString()),
        }),
      );
      if (this.agrees(loan, collectedFromLedger)) continue;

      const mismatch = await this.database.transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM account_loan WHERE id = ${loan.id} FOR UPDATE`;
        const locked = await tx.accountLoan.findUniqueOrThrow({
          where: { id: loan.id },
          select: {
            accountAmount: true,
            collectedAmount: true,
            outstandingAmount: true,
          },
        });
        const nowReceivable = await this.balanceOf(
          tx,
          receivableOf.get(loan.id)!,
          'DEBIT',
        );
        const nowCollected = toMoney(locked.accountAmount.toString()).minus(
          nowReceivable,
        );
        if (this.agrees(locked, nowCollected)) return null;
        const found = {
          accountLoanId: loan.id,
          accountCode: loan.accountCode,
          collectedAmount: toMoney(locked.collectedAmount.toString()).toFixed(
            2,
          ),
          outstandingAmount: toMoney(
            locked.outstandingAmount.toString(),
          ).toFixed(2),
          collectedFromLedger: nowCollected.toFixed(2),
        };
        await this.audit.recordSystem(system, {
          action: 'UPDATE',
          entityTable: 'account_loan',
          entityId: loan.id,
          after: {
            reconciliation:
              'collected amount disagrees with the ledger; not changed',
            ...found,
          },
        });
        return found;
      });
      if (mismatch) {
        report.accountMismatches.push(mismatch);
        this.logger.error(
          {
            organizationId: system.organizationId,
            accountLoanId: loan.id,
            runId: system.runId,
          },
          'Account collected amount disagrees with the ledger',
        );
      }
    }

    const unearned = accounts.find(
      (account) => account.accountType === 'UNEARNED_PROFIT',
    );
    if (unearned) {
      const ledger = fromEntries.get(unearned.id) ?? toMoney('0');
      if (!ledger.equals(expectedUnearned)) {
        report.unearnedMismatch = {
          ledger: ledger.toFixed(2),
          expected: expectedUnearned.toFixed(2),
        };
        const mismatch = report.unearnedMismatch;
        await this.database.transaction(() =>
          this.audit.recordSystem(system, {
            action: 'UPDATE',
            entityTable: 'ledger_account',
            entityId: unearned.id,
            after: {
              reconciliation:
                'unearned profit disagrees with the accounts; not changed',
              ...mismatch,
            },
          }),
        );
        this.logger.error(
          {
            organizationId: system.organizationId,
            ledgerAccountId: unearned.id,
            runId: system.runId,
          },
          'Unearned profit disagrees with the accounts',
        );
      }
    }
    // US-095: any mismatch is an ALERT to Admins and Super Admins.
    await this.database.transaction(() =>
      this.notices.reconciliationMismatch({
        organizationId: system.organizationId,
        rebuilt: report.rebuilt.length,
        accountMismatches: report.accountMismatches.length,
        unearned: report.unearnedMismatch !== null,
      }),
    );
    return report;
  }

  /** A cached figure agrees when collected matches the ledger and outstanding is A − collected. */
  private agrees(
    loan: {
      accountAmount: { toString(): string };
      collectedAmount: { toString(): string };
      outstandingAmount: { toString(): string };
    },
    collectedFromLedger: Decimal,
  ): boolean {
    const collected = toMoney(loan.collectedAmount.toString());
    return (
      collected.equals(collectedFromLedger) &&
      toMoney(loan.outstandingAmount.toString()).equals(
        toMoney(loan.accountAmount.toString()).minus(collected),
      )
    );
  }

  /** Every ledger account's balance from entries, signed by its normal balance. */
  private async balancesFromEntries(
    tx: Tx,
    organizationId: string,
  ): Promise<Map<string, Decimal>> {
    const rows = await tx.$queryRaw<{ id: string; balance: string }[]>`
      SELECT a.id, COALESCE(SUM(CASE WHEN e.direction = a."normalBalance" THEN e.amount ELSE -e.amount END), 0)::text AS balance
      FROM ledger_account a
      LEFT JOIN ledger_entry e ON e."ledgerAccountId" = a.id
      WHERE a."organizationId" = ${organizationId}
      GROUP BY a.id`;
    return new Map(rows.map((row) => [row.id, toMoney(row.balance)]));
  }

  private async balanceOf(
    tx: Tx,
    ledgerAccountId: string,
    normalBalance: 'DEBIT' | 'CREDIT',
  ): Promise<Decimal> {
    const [row] = await tx.$queryRaw<{ balance: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN direction::text = ${normalBalance} THEN amount ELSE -amount END), 0)::text AS balance
      FROM ledger_entry WHERE "ledgerAccountId" = ${ledgerAccountId}`;
    return toMoney(row?.balance ?? '0');
  }
}

/** A corrupt figure outside 0…A would make `unearnedProfit` throw; clamp for the sum. */
function clamp(collected: Decimal, accountAmount: string): Decimal {
  if (collected.isNegative()) return toMoney('0');
  return collected.greaterThan(accountAmount)
    ? toMoney(accountAmount)
    : collected;
}
