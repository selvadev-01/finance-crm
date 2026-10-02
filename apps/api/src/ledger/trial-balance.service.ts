import { Injectable } from '@nestjs/common';
import type { TrialBalance, TrialBalanceRow } from '@repo/contracts';
import {
  type CalendarDate,
  parseCalendarDate,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { seesOrganizationLedger } from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';

/** The order a trial balance is read in: assets, then what funds them. */
const ORDER: TrialBalanceRow['accountType'][] = [
  'CASH_AT_OFFICE',
  'BANK',
  'CASH_IN_HAND',
  'LOAN_RECEIVABLE',
  'EXPENSE',
  'WRITE_OFF_LOSS',
  'OWNER_DRAWINGS',
  'CAPITAL',
  'UNEARNED_PROFIT',
  'EARNED_PROFIT',
  'OTHER_INCOME',
];

interface Grouped {
  accountType: TrialBalanceRow['accountType'];
  ownerUserId: string | null;
  ownerName: string | null;
  referenceId: string | null;
  referenceName: string | null;
  accounts: bigint;
  ledgerAccountId: string | null;
  debits: string;
  credits: string;
}

/**
 * M09's trial balance, from the entries themselves — never the `balance`
 * caches the nightly reconciliation checks — so it is the ledger's own
 * statement up to a business date. Cash in hand is one row per staff member,
 * an expense one per category and a bank one per bank (ADR-0018); every other
 * type, the receivables included, is one row per type.
 */
@Injectable()
export class TrialBalanceService {
  constructor(private readonly database: Database) {}

  async trialBalance(
    context: RequestContext,
    query: { date?: string | undefined },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<TrialBalance> {
    const asOf = query.date ? parseCalendarDate(query.date) : today;
    // Admin and above only (M09, `ledger.view`); anyone else sees no rows.
    const grouped = seesOrganizationLedger(context)
      ? await this.database.client.$queryRaw<Grouped[]>`
          SELECT la."accountType",
                 CASE WHEN la."accountType" = 'CASH_IN_HAND' THEN la."ownerUserId" END AS "ownerUserId",
                 CASE WHEN la."accountType" = 'CASH_IN_HAND' THEN u.name END AS "ownerName",
                 COALESCE(la."expenseCategoryId", la."bankAccountId") AS "referenceId",
                 COALESCE(c.name, b.name) AS "referenceName",
                 COUNT(DISTINCT la.id) AS accounts,
                 CASE WHEN COUNT(DISTINCT la.id) = 1 THEN MIN(la.id) END AS "ledgerAccountId",
                 COALESCE(SUM(e.amount) FILTER (WHERE e.direction = 'DEBIT'), 0)::text AS debits,
                 COALESCE(SUM(e.amount) FILTER (WHERE e.direction = 'CREDIT'), 0)::text AS credits
          FROM ledger_entry e
          JOIN ledger_transaction t ON t.id = e."ledgerTransactionId"
          JOIN ledger_account la ON la.id = e."ledgerAccountId"
          LEFT JOIN "user" u ON u.id = la."ownerUserId"
          LEFT JOIN expense_category c ON c.id = la."expenseCategoryId"
          LEFT JOIN bank_account b ON b.id = la."bankAccountId"
          WHERE la."organizationId" = ${context.organizationId}
            AND t."businessDate" <= ${toUtcMidnight(asOf)}
          GROUP BY 1, 2, 3, 4, 5`
      : [];

    const rows = grouped
      .map((group) => toRow(group))
      .sort(
        (a, b) =>
          ORDER.indexOf(a.accountType) - ORDER.indexOf(b.accountType) ||
          (a.ownerName ?? a.referenceName ?? '').localeCompare(
            b.ownerName ?? b.referenceName ?? '',
          ),
      );
    const debitBalance = rows.reduce(
      (sum, row) => sum.plus(row.debitBalance),
      toMoney('0'),
    );
    const creditBalance = rows.reduce(
      (sum, row) => sum.plus(row.creditBalance),
      toMoney('0'),
    );
    return {
      asOf,
      generatedAt: new Date().toISOString(),
      rows,
      totals: {
        debitBalance: debitBalance.toFixed(2),
        creditBalance: creditBalance.toFixed(2),
      },
      balanced: debitBalance.equals(creditBalance),
    };
  }
}

function toRow(group: Grouped): TrialBalanceRow {
  const net = toMoney(group.debits).minus(group.credits);
  return {
    accountType: group.accountType,
    ownerUserId: group.ownerUserId,
    ownerName: group.ownerName,
    referenceId: group.referenceId,
    referenceName: group.referenceName,
    accounts: Number(group.accounts),
    ledgerAccountId: group.ledgerAccountId,
    debits: toMoney(group.debits).toFixed(2),
    credits: toMoney(group.credits).toFixed(2),
    debitBalance: net.isNegative() ? '0.00' : net.toFixed(2),
    creditBalance: net.isNegative() ? net.negated().toFixed(2) : '0.00',
  };
}
