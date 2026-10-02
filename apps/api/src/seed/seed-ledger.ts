import { randomUUID } from 'node:crypto';

import type { Prisma } from '@repo/db';
import {
  addCalendarDays,
  type CalendarDate,
  type HolidaySet,
  isWorkingDay,
  type toMoney,
  toUtcMidnight,
} from '@repo/domain';

/**
 * What the seed (`seed.ts`) and the Books top-up (`office-books.ts`) share:
 * the working-day walk back from `asOf`, and the ledger poster that collects
 * balanced transactions and writes them with their balance cache.
 */
export type Money = ReturnType<typeof toMoney>;

export const ist = (date: CalendarDate, time: string) =>
  new Date(`${date}T${time}+05:30`);

/** The n-th working day before `asOf`. */
export function workingDaysBefore(
  asOf: CalendarDate,
  n: number,
  holidays: HolidaySet,
): CalendarDate {
  let date = asOf;
  for (let found = 0; found < n;) {
    date = addCalendarDays(date, -1);
    if (isWorkingDay(date, holidays)) found += 1;
  }
  return date;
}

export async function inBatches<Row>(
  rows: Row[],
  write: (batch: Row[]) => Promise<unknown>,
) {
  for (let i = 0; i < rows.length; i += 2000)
    await write(rows.slice(i, i + 2000));
}

export type SeedTransactionType =
  | 'DISBURSEMENT'
  | 'COLLECTION'
  | 'HANDOVER'
  | 'ADJUSTMENT'
  | 'EXPENSE'
  | 'BANK_TRANSFER'
  | 'OTHER_INCOME'
  | 'DRAWINGS'
  | 'JOURNAL';

export function createLedgerPoster() {
  const transactions: Prisma.LedgerTransactionCreateManyInput[] = [];
  const entries: Prisma.LedgerEntryCreateManyInput[] = [];
  const post = (
    type: SeedTransactionType,
    source: { table: string; id: string },
    date: CalendarDate,
    description: string,
    lines: { account: string; direction: 'DEBIT' | 'CREDIT'; amount: Money }[],
  ) => {
    const transactionId = randomUUID();
    transactions.push({
      id: transactionId,
      transactionType: type,
      sourceTable: source.table,
      sourceId: source.id,
      businessDate: toUtcMidnight(date),
      eventAt: ist(date, '18:00:00'),
      description,
    });
    lines
      .filter((line) => line.amount.greaterThan(0))
      .forEach((line, i) =>
        entries.push({
          ledgerTransactionId: transactionId,
          ledgerAccountId: line.account,
          direction: line.direction,
          amount: line.amount.toString(),
          sequence: i + 1,
        }),
      );
  };
  return { transactions, entries, post };
}

export type LedgerPoster = ReturnType<typeof createLedgerPoster>;

/**
 * Writes the poster's transactions and entries, then moves the balance cache
 * (M09 reconciles it nightly), signed per normal balance. One set-based UPDATE
 * over this poster's transactions only; the id array is parameterised.
 */
export async function writePostings(
  tx: Prisma.TransactionClient,
  { transactions, entries }: LedgerPoster,
) {
  await inBatches(transactions, (data) =>
    tx.ledgerTransaction.createMany({ data }),
  );
  await inBatches(entries, (data) => tx.ledgerEntry.createMany({ data }));
  await tx.$executeRaw`
    UPDATE ledger_account AS la
    SET balance = la.balance + delta.amount
    FROM (
      SELECT e."ledgerAccountId" AS id,
             SUM(CASE WHEN e.direction = a."normalBalance" THEN e.amount ELSE -e.amount END) AS amount
      FROM ledger_entry e
      JOIN ledger_account a ON a.id = e."ledgerAccountId"
      JOIN ledger_transaction t ON t.id = e."ledgerTransactionId"
      WHERE t.id = ANY(${transactions.map((t) => t.id!)})
      GROUP BY e."ledgerAccountId"
    ) AS delta
    WHERE la.id = delta.id`;
}
