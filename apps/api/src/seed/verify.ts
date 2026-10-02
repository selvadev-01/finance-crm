import type { Prisma } from '@repo/db';
import { recognisedProfit, toMoney, unearnedProfit } from '@repo/domain';

import type { SeedReport } from './seed.js';

/**
 * Checks the seeded dataset against the money rules before it is committed —
 * or rolled back. Returns the problems found; an empty list means it is sound.
 *
 * The ledger's own balancing trigger is deferred, so `run.ts` forces it with
 * `SET CONSTRAINTS ALL IMMEDIATE` before this runs.
 */
export async function verifySeed(
  tx: Prisma.TransactionClient,
  report: SeedReport,
): Promise<string[]> {
  const problems: string[] = [];
  const organizationId = report.organizationId;

  const accounts = await tx.accountLoan.findMany({
    where: { organizationId },
    select: {
      id: true,
      accountCode: true,
      accountAmount: true,
      profitAmount: true,
      collectedAmount: true,
      outstandingAmount: true,
      status: true,
      isOverdue: true,
      ledgerAccounts: { select: { balance: true } },
    },
  });
  const collectedByAccount = new Map(
    (
      await tx.collection.groupBy({
        by: ['accountLoanId'],
        where: { accountLoan: { organizationId } },
        _sum: { amount: true },
      })
    ).map((row) => [
      row.accountLoanId,
      toMoney(row._sum.amount?.toString() ?? '0'),
    ]),
  );

  let earnedExpected = toMoney('0');
  let unearnedExpected = toMoney('0');
  for (const account of accounts) {
    const collected = collectedByAccount.get(account.id) ?? toMoney('0');
    const A = account.accountAmount.toString();
    const P = account.profitAmount.toString();
    if (!collected.equals(account.collectedAmount.toString())) {
      problems.push(
        `${account.accountCode}: collectedAmount ${account.collectedAmount} ≠ collections ${collected}`,
      );
    }
    if (
      !toMoney(A).minus(collected).equals(account.outstandingAmount.toString())
    ) {
      problems.push(
        `${account.accountCode}: outstanding does not equal A − collected`,
      );
    }
    const receivable = account.ledgerAccounts[0]?.balance.toString();
    if (
      !toMoney(receivable ?? '-1').equals(account.outstandingAmount.toString())
    ) {
      problems.push(
        `${account.accountCode}: LOAN_RECEIVABLE ${receivable} ≠ outstanding ${account.outstandingAmount}`,
      );
    }
    if (account.status === 'COMPLETED' && !collected.equals(A)) {
      problems.push(
        `${account.accountCode}: COMPLETED but collected ${collected} ≠ ${A}`,
      );
    }
    earnedExpected = earnedExpected.plus(
      recognisedProfit({ accountAmount: A, profitAmount: P, collected }),
    );
    unearnedExpected = unearnedExpected.plus(
      unearnedProfit({ accountAmount: A, profitAmount: P, collected }),
    );
  }

  // Profit postings for this organization's transactions only — the profit
  // ledger accounts are shared singletons.
  const profit = await tx.$queryRaw<{ accountType: string; net: string }[]>`
    SELECT a."accountType",
           SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END)::text AS net
    FROM ledger_entry e
    JOIN ledger_account a ON a.id = e."ledgerAccountId"
    JOIN ledger_transaction t ON t.id = e."ledgerTransactionId"
    WHERE a."accountType" IN ('EARNED_PROFIT', 'UNEARNED_PROFIT')
      AND (
        (t."sourceTable" = 'account_loan' AND t."sourceId" IN (SELECT id FROM account_loan WHERE "organizationId" = ${organizationId}))
        OR (t."sourceTable" = 'collection' AND t."sourceId" IN (
          SELECT c.id FROM collection c JOIN account_loan l ON l.id = c."accountLoanId" WHERE l."organizationId" = ${organizationId}))
      )
    GROUP BY a."accountType"`;
  const net = (type: string) =>
    toMoney(profit.find((row) => row.accountType === type)?.net ?? '0');
  if (!net('EARNED_PROFIT').equals(earnedExpected)) {
    problems.push(
      `EARNED_PROFIT ${net('EARNED_PROFIT')} ≠ recognised profit ${earnedExpected} (BR-18)`,
    );
  }
  if (!net('UNEARNED_PROFIT').equals(unearnedExpected)) {
    problems.push(
      `UNEARNED_PROFIT ${net('UNEARNED_PROFIT')} ≠ unearned profit ${unearnedExpected} (BR-18)`,
    );
  }

  // Cash: everything collected sits in some staff member's hand, less what an
  // approved field expense spent from it (ADR-0018).
  const [cash] = await tx.$queryRaw<
    { held: string | null; collected: string | null; spent: string | null }[]
  >`
    SELECT
      (SELECT SUM(a.balance)::text FROM ledger_account a
        JOIN staff_profile s ON s."userId" = a."ownerUserId"
        WHERE a."accountType" = 'CASH_IN_HAND' AND s."organizationId" = ${organizationId}) AS held,
      (SELECT SUM(c.amount)::text FROM collection c
        JOIN account_loan l ON l.id = c."accountLoanId"
        WHERE l."organizationId" = ${organizationId}) AS collected,
      (SELECT SUM(x.amount)::text FROM expense x
        WHERE x."organizationId" = ${organizationId}
          AND x."paidFrom" = 'CASH_IN_HAND' AND x.status = 'APPROVED') AS spent`;
  const expectedHeld = toMoney(cash?.collected ?? '0').minus(
    toMoney(cash?.spent ?? '0'),
  );
  if (!toMoney(cash?.held ?? '0').equals(expectedHeld)) {
    problems.push(
      `CASH_IN_HAND ${cash?.held} ≠ cash collected ${cash?.collected} less approved field expenses ${cash?.spent ?? '0'}`,
    );
  }

  // Every expense that is approved is posted once, and nothing else is.
  const [posted] = await tx.$queryRaw<{ unposted: bigint; stray: bigint }[]>`
    SELECT
      (SELECT COUNT(*) FROM expense x
        WHERE x."organizationId" = ${organizationId} AND x.status = 'APPROVED'
          AND NOT EXISTS (SELECT 1 FROM ledger_transaction t
            WHERE t."sourceTable" = 'expense' AND t."sourceId" = x.id)) AS unposted,
      (SELECT COUNT(*) FROM expense x
        WHERE x."organizationId" = ${organizationId} AND x.status <> 'APPROVED'
          AND EXISTS (SELECT 1 FROM ledger_transaction t
            WHERE t."sourceTable" = 'expense' AND t."sourceId" = x.id)) AS stray`;
  if (Number(posted?.unposted ?? 0) > 0 || Number(posted?.stray ?? 0) > 0) {
    problems.push(
      `expenses: ${posted?.unposted} approved without a posting, ${posted?.stray} posted without approval`,
    );
  }

  // Day closes agree with the collections they close.
  const mismatched = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM day_close d
    JOIN line ln ON ln.id = d."lineId"
    WHERE ln."organizationId" = ${organizationId}
      AND d."collectedTotal" <> COALESCE((
        SELECT SUM(c.amount) FROM collection c
        WHERE c."lineId" = d."lineId" AND c."businessDate" = d."businessDate"), 0)`;
  if (Number(mismatched[0]?.count ?? 0) > 0) {
    problems.push(
      `${mismatched[0]?.count} day closes disagree with their collections`,
    );
  }

  // The named cases exist and look like themselves.
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const uneven = byId.get(report.cases.unevenCompletedAccountId);
  if (uneven?.status !== 'COMPLETED')
    problems.push('the uneven-instalment account did not complete');
  const overdue = byId.get(report.cases.overdueAccountId);
  if (!overdue?.isOverdue)
    problems.push('the overdue account is not flagged overdue');
  if (!report.cases.discrepancyDayCloseId)
    problems.push('no cash discrepancy was seeded');
  if (!report.cases.correctedCollectionId)
    problems.push('no approved correction was seeded');
  const fieldExpense = report.cases.fieldExpenseId
    ? await tx.expense.findUnique({
        where: { id: report.cases.fieldExpenseId },
        select: { lineId: true, businessDate: true, amount: true },
      })
    : null;
  if (!fieldExpense) {
    problems.push('no approved field expense was seeded');
  } else {
    const day = await tx.dayClose.findUnique({
      where: {
        lineId_businessDate: {
          lineId: fieldExpense.lineId!,
          businessDate: fieldExpense.businessDate,
        },
      },
      select: { expenseTotal: true },
    });
    if (
      !day ||
      !toMoney(day.expenseTotal.toString()).equals(
        fieldExpense.amount.toString(),
      )
    )
      problems.push("the field expense's day close does not count it");
  }
  const transferLines = await tx.collection.findMany({
    where: { accountLoan: { customerId: report.cases.transferredCustomerId } },
    distinct: ['lineId'],
    select: { lineId: true },
  });
  if (transferLines.length < 2)
    problems.push('the transferred customer has collections on only one line');

  return problems;
}
