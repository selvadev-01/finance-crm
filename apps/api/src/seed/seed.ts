import { randomUUID } from 'node:crypto';

import type { Prisma } from '@repo/db';
import {
  addCalendarDays,
  addWorkingDays,
  type CalendarDate,
  capExpectedAmount,
  classifyCollection,
  generateSchedule,
  type HolidaySet,
  isWorkingDay,
  profitForCollection,
  targetCompletionDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { createRandom, type Random } from './prng.js';

/**
 * The seed dataset (Phase 1 backlog): one organization, "Rasi Seed", with a
 * month and more of plausible collection history and the awkward cases the
 * backlog names. Built from `packages/domain` — schedules (BR-04), the
 * expected-amount cap (BR-07), classification (BR-08), profit apportionment
 * (BR-18) — and posted to the ledger per BR-18's tables.
 *
 * **Decided 2026-09-13 (option C): seeded directly, before M05/M07/M08/M09
 * exist.** Money rows are append-only, so a committed seed is permanent in
 * `rasi_dev`; `run.ts` therefore dry-runs by default. Where the real modules
 * later differ from what is written here, the seed is wrong, not the modules.
 *
 * Simplifications, deliberate and recorded in the backlog:
 * - Shortfalls extend an account by **appending** slots (BR-06's regenerated
 *   tail) rather than rewriting pending ones; earlier slots keep their status.
 * - A slot answered by `NO_PAYMENT` or a low payment is `PARTIAL`; a slot with
 *   no visit is `MISSED` (BR-09 keeps the distinction on the collection row).
 * - Cash moves Junior → Senior daily; Senior → Admin is not seeded.
 * - Nothing is written to `audit_log`.
 */
export const SEED_ORGANIZATION_NAME = 'Rasi Seed';
export const SEED_PASSWORD = 'rasi-seed-password';

type Money = ReturnType<typeof toMoney>;

export interface SeedOptions {
  /** The business date the dataset is "as of". History ends the day before. */
  asOf: CalendarDate;
  lines: number;
  /** Customers with one account; `concurrentCustomers` more hold two. */
  customers: number;
  concurrentCustomers: number;
  /** Disbursements fall within this many working days before `asOf`. */
  historyWorkingDays: number;
  /** A password hash for every seeded staff member (SEED_PASSWORD). */
  passwordHash: string;
  randomSeed?: number;
  /**
   * Four digits woven into every value unique across the whole database —
   * staff emails, staff codes, staff phones, customer and account codes — so a
   * rolled-back test run does not collide with a seed already committed to the
   * shared schema. The real seed leaves it unset and its values are unchanged.
   */
  tag?: string;
}

export interface SeedReport {
  organizationId: string;
  staffEmails: string[];
  counts: Record<string, number>;
  cases: {
    unevenCompletedAccountId: string;
    overdueAccountId: string;
    transferredCustomerId: string;
    discrepancyDayCloseId: string;
    correctedCollectionId: string;
    concurrentCustomerIds: string[];
  };
}

type Behaviour =
  'CORRECT' | 'LOW' | 'EXTRA' | 'NO_PAYMENT' | 'MISSED' | 'MISKEYED';

interface AccountPlan {
  id: string;
  code: string;
  customerId: string;
  lineId: string;
  amount: string;
  invested: string;
  daily: string;
  disbursement: CalendarDate;
  behaviour: (index: number, random: Random) => Behaviour;
  /** For the transferred customer: from this date collections are on `toLineId`. */
  transfer?: { on: CalendarDate; toLineId: string };
}

const TERMS = [
  { amount: '10000', invested: '8500', daily: '100' },
  { amount: '5000', invested: '4250', daily: '50' },
  { amount: '20000', invested: '17000', daily: '200' },
  { amount: '10000', invested: '8500', daily: '150' },
  { amount: '15000', invested: '12750', daily: '150' },
] as const;

function everyday(random: Random): Behaviour {
  const roll = random.next();
  if (roll < 0.85) return 'CORRECT';
  if (roll < 0.9) return 'LOW';
  if (roll < 0.94) return 'EXTRA';
  if (roll < 0.97) return 'NO_PAYMENT';
  return 'MISSED';
}

const ist = (date: CalendarDate, time: string) =>
  new Date(`${date}T${time}+05:30`);

function notes(amount: number): { denomination: number; count: number }[] {
  const result: { denomination: number; count: number }[] = [];
  let left = amount;
  for (const denomination of [500, 200, 100, 50, 20, 10, 5, 2, 1]) {
    const count = Math.floor(left / denomination);
    if (count > 0) {
      result.push({ denomination, count });
      left -= count * denomination;
    }
  }
  return result;
}

export async function seedDataset(
  tx: Prisma.TransactionClient,
  options: SeedOptions,
): Promise<SeedReport> {
  const random = createRandom(options.randomSeed ?? 20260913);
  const lastHistoryDate = addCalendarDays(options.asOf, -1);

  // ---------------------------------------------------------------- structure
  const organization = await tx.organization.create({
    data: {
      name: SEED_ORGANIZATION_NAME,
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    },
  });
  const orgId = organization.id;

  // One business-wide holiday inside the history window, on a weekday.
  let seedHoliday = addCalendarDays(options.asOf, -12);
  if (!isWorkingDay(seedHoliday, new Set()))
    seedHoliday = addCalendarDays(seedHoliday, -1);
  await tx.holiday.create({
    data: {
      organizationId: orgId,
      date: toUtcMidnight(seedHoliday),
      name: 'Seed festival holiday',
    },
  });
  const holidays: HolidaySet = new Set([seedHoliday]);
  /** The n-th working day before `asOf`. */
  const workingDaysBack = (n: number): CalendarDate => {
    let date = options.asOf;
    for (let found = 0; found < n;) {
      date = addCalendarDays(date, -1);
      if (isWorkingDay(date, holidays)) found += 1;
    }
    return date;
  };

  const sectorIds = [randomUUID(), randomUUID()];
  await tx.sector.createMany({
    data: [
      {
        id: sectorIds[0]!,
        organizationId: orgId,
        code: 'SEED-SEC-N',
        name: 'North',
      },
      {
        id: sectorIds[1]!,
        organizationId: orgId,
        code: 'SEED-SEC-S',
        name: 'South',
      },
    ],
  });
  const lineIds: string[] = Array.from({ length: options.lines }, () =>
    randomUUID(),
  );
  await tx.line.createMany({
    data: lineIds.map((id, i) => ({
      id,
      organizationId: orgId,
      sectorId: sectorIds[i % 2]!,
      code: `SEED-LN-${String(i + 1).padStart(2, '0')}`,
      name: `Line ${i + 1}`,
    })),
  });

  // -------------------------------------------------------------------- staff
  const staffEmails: string[] = [];
  const userIds: Record<string, string> = {};
  const staffIds: Record<string, string> = {};
  const staffRows: {
    key: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'SENIOR' | 'JUNIOR';
  }[] = [
    { key: 'superadmin', role: 'SUPER_ADMIN' },
    { key: 'admin', role: 'ADMIN' },
    ...lineIds.map((_, i) => ({
      key: `senior${i + 1}`,
      role: 'SENIOR' as const,
    })),
    { key: `senior${options.lines + 1}`, role: 'SENIOR' },
    ...lineIds.map((_, i) => ({
      key: `junior${i + 1}`,
      role: 'JUNIOR' as const,
    })),
  ];
  const historyFloor = workingDaysBack(options.historyWorkingDays + 140);
  const tag = options.tag ?? '';
  if (tag !== '' && !/^\d{4}$/.test(tag)) {
    throw new Error('Seed tag must be four digits');
  }
  const tagged = (value: string) => (tag ? `${value}-${tag}` : value);
  for (const [index, { key, role }] of staffRows.entries()) {
    const userId = randomUUID();
    const email = `seed.${key}${tag ? `.${tag}` : ''}@rasi.seed`;
    userIds[key] = userId;
    staffIds[key] = randomUUID();
    staffEmails.push(email);
    await tx.user.create({
      data: { id: userId, name: `Seed ${key}`, email, emailVerified: true },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: options.passwordHash,
      },
    });
    await tx.staffProfile.create({
      data: {
        id: staffIds[key],
        organizationId: orgId,
        userId,
        staffCode: tagged(`SEED-${key.toUpperCase()}`),
        role,
        // +91 and ten digits either way: `9` + `0000` (or the tag) + the index.
        phone: `+919${tag || '0000'}${String(index).padStart(5, '0')}`,
        joinedAt: toUtcMidnight(historyFloor),
      },
    });
  }

  // Assignments: Senior i and Junior i on Line i from the start. Mid-history,
  // Juniors 4 and 5 swap lines (US-013) and Line 2's Senior is replaced (US-012).
  const moveDate = workingDaysBack(Math.floor(options.historyWorkingDays / 2));
  const dayBefore = addCalendarDays(moveDate, -1);
  const assignments: Prisma.LineAssignmentCreateManyInput[] = [];
  const swapA = Math.min(3, options.lines - 2);
  const swapB = swapA + 1;
  lineIds.forEach((lineId, i) => {
    const senior = `senior${i + 1}`;
    const junior = `junior${i + 1}`;
    const replaced = i === 1;
    assignments.push({
      lineId,
      staffProfileId: staffIds[senior]!,
      assignmentRole: 'SENIOR',
      effectiveFrom: toUtcMidnight(historyFloor),
      effectiveTo: replaced ? toUtcMidnight(dayBefore) : null,
    });
    const swaps = i === swapA || i === swapB;
    assignments.push({
      lineId,
      staffProfileId: staffIds[junior]!,
      assignmentRole: 'JUNIOR',
      effectiveFrom: toUtcMidnight(historyFloor),
      effectiveTo: swaps ? toUtcMidnight(dayBefore) : null,
    });
  });
  assignments.push(
    {
      lineId: lineIds[1]!,
      staffProfileId: staffIds[`senior${options.lines + 1}`]!,
      assignmentRole: 'SENIOR',
      effectiveFrom: toUtcMidnight(moveDate),
      reason: 'Seed: Senior replaced mid-history',
    },
    {
      lineId: lineIds[swapB]!,
      staffProfileId: staffIds[`junior${swapA + 1}`]!,
      assignmentRole: 'JUNIOR',
      effectiveFrom: toUtcMidnight(moveDate),
      reason: 'Seed: Juniors swap lines',
    },
    {
      lineId: lineIds[swapA]!,
      staffProfileId: staffIds[`junior${swapB + 1}`]!,
      assignmentRole: 'JUNIOR',
      effectiveFrom: toUtcMidnight(moveDate),
      reason: 'Seed: Juniors swap lines',
    },
  );
  await tx.lineAssignment.createMany({ data: assignments });

  const staffOnLine = (
    lineIndex: number,
    date: CalendarDate,
    role: 'senior' | 'junior',
  ) => {
    if (role === 'senior') {
      if (lineIndex === 1 && date >= moveDate)
        return `senior${options.lines + 1}`;
      return `senior${lineIndex + 1}`;
    }
    if (date >= moveDate && lineIndex === swapA) return `junior${swapB + 1}`;
    if (date >= moveDate && lineIndex === swapB) return `junior${swapA + 1}`;
    return `junior${lineIndex + 1}`;
  };

  // ---------------------------------------------------------------- customers
  const customers: Prisma.CustomerCreateManyInput[] = [];
  const references: Prisma.CustomerReferenceCreateManyInput[] = [];
  const plans: AccountPlan[] = [];
  const totalCustomers = options.customers + options.concurrentCustomers;
  let accountNumber = 0;

  for (let c = 0; c < totalCustomers; c += 1) {
    const customerId = randomUUID();
    const lineIndex = c % options.lines;
    customers.push({
      id: customerId,
      organizationId: orgId,
      customerCode: tagged(`SEED-CUS-${String(c + 1).padStart(4, '0')}`),
      name: `Seed Customer ${c + 1}`,
      mobile: `+9198${String(10_000_000 + c).padStart(8, '0')}`,
      address: `${c + 1} Market Street`,
      sectorId: sectorIds[lineIndex % 2]!,
      lineId: lineIds[lineIndex]!,
    });
    references.push({
      customerId,
      name: `Reference for ${c + 1}`,
      mobile: `+9197${String(10_000_000 + c).padStart(8, '0')}`,
      relation: 'neighbour',
    });
    const accountsHere = c >= options.customers ? 2 : 1;
    for (let a = 0; a < accountsHere; a += 1) {
      accountNumber += 1;
      const terms = random.pick(TERMS);
      plans.push({
        id: randomUUID(),
        code: tagged(`SEED-ACC-${String(accountNumber).padStart(4, '0')}`),
        customerId,
        lineId: lineIds[lineIndex]!,
        ...terms,
        amount: terms.amount,
        disbursement: workingDaysBack(
          random.int(2, options.historyWorkingDays),
        ),
        behaviour: (_index, r) => everyday(r),
      });
    }
  }

  // The named cases take the first accounts, overriding their random plan.
  const uneven = plans[0]!;
  Object.assign(uneven, {
    amount: '10000',
    invested: '8500',
    daily: '150',
    disbursement: workingDaysBack(80),
    behaviour: () => 'CORRECT' as const,
  });
  const overdue = plans[1]!;
  Object.assign(overdue, {
    amount: '10000',
    invested: '8500',
    daily: '100',
    disbursement: workingDaysBack(130),
    behaviour: (index: number) => (index < 90 ? 'CORRECT' : 'MISSED'),
  });
  const transferred = plans[2]!;
  const transferLine = (options.lines > 1 ? 1 : 0) as number;
  Object.assign(transferred, {
    amount: '10000',
    invested: '8500',
    daily: '100',
    disbursement: workingDaysBack(Math.min(40, options.historyWorkingDays)),
    transfer: { on: workingDaysBack(15), toLineId: lineIds[transferLine]! },
  });
  const transferredCustomer = customers.find(
    (c) => c.id === transferred.customerId,
  )!;
  transferredCustomer.lineId = lineIds[transferLine]!;
  transferredCustomer.sectorId = sectorIds[transferLine % 2]!;
  const corrected = plans[3]!;
  Object.assign(corrected, {
    amount: '10000',
    invested: '8500',
    daily: '100',
    disbursement: workingDaysBack(Math.min(30, options.historyWorkingDays)),
    behaviour: (index: number) => (index === 5 ? 'MISKEYED' : 'CORRECT'),
  });

  await tx.customer.createMany({ data: customers });
  await tx.customerReference.createMany({ data: references });

  // ------------------------------------------------------------------- ledger
  const ledgerAccounts: Prisma.LedgerAccountCreateManyInput[] = [];
  // The seed organization is new, so its business-wide accounts are too: one
  // of each per organization (ledger_account_organization_singleton_key).
  const singleton = (
    accountType: 'CASH_AT_OFFICE' | 'UNEARNED_PROFIT' | 'EARNED_PROFIT',
  ) => {
    const id = randomUUID();
    ledgerAccounts.push({
      id,
      organizationId: orgId,
      accountType,
      normalBalance: accountType === 'CASH_AT_OFFICE' ? 'DEBIT' : 'CREDIT',
    });
    return id;
  };
  const officeCash = singleton('CASH_AT_OFFICE');
  const unearnedProfit = singleton('UNEARNED_PROFIT');
  const earnedProfit = singleton('EARNED_PROFIT');
  const cashInHand: Record<string, string> = {};
  for (const { key, role } of staffRows) {
    if (role !== 'SENIOR' && role !== 'JUNIOR') continue;
    cashInHand[key] = randomUUID();
    ledgerAccounts.push({
      id: cashInHand[key],
      organizationId: orgId,
      accountType: 'CASH_IN_HAND',
      ownerUserId: userIds[key]!,
      normalBalance: 'DEBIT',
    });
  }

  const transactions: Prisma.LedgerTransactionCreateManyInput[] = [];
  const entries: Prisma.LedgerEntryCreateManyInput[] = [];
  const post = (
    type: 'DISBURSEMENT' | 'COLLECTION' | 'HANDOVER' | 'ADJUSTMENT',
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

  // ----------------------------------------------------------------- accounts
  const accountRows: Prisma.AccountLoanCreateManyInput[] = [];
  const scheduleRows: Prisma.AccountScheduleCreateManyInput[] = [];
  const collectionRows: Prisma.CollectionCreateManyInput[] = [];
  const adjustmentRows: Prisma.CollectionCreateManyInput[] = [];
  const approvalRows: Prisma.CollectionApprovalCreateManyInput[] = [];
  /** `${lineIndex}|${date}` → totals for the day close. */
  const days = new Map<
    string,
    {
      lineIndex: number;
      date: CalendarDate;
      expected: Money;
      collected: Money;
      byCollector: Map<string, Money>;
    }
  >();
  const day = (lineIndex: number, date: CalendarDate) => {
    const key = `${lineIndex}|${date}`;
    let entry = days.get(key);
    if (!entry) {
      entry = {
        lineIndex,
        date,
        expected: toMoney('0'),
        collected: toMoney('0'),
        byCollector: new Map(),
      };
      days.set(key, entry);
    }
    return entry;
  };
  let correctedCollectionId = '';

  for (const plan of plans) {
    const A = toMoney(plan.amount);
    const D = toMoney(plan.daily);
    const P = A.minus(plan.invested);
    const receivable = randomUUID();
    ledgerAccounts.push({
      id: receivable,
      organizationId: orgId,
      accountType: 'LOAN_RECEIVABLE',
      accountLoanId: plan.id,
      normalBalance: 'DEBIT',
    });

    let collected = toMoney('0');
    let lastCollection: CalendarDate | null = null;
    let completedOn: CalendarDate | null = null;
    let slots = generateSchedule({
      outstanding: A,
      dailyAmount: D,
      after: plan.disbursement,
      holidays,
      firstSequence: 1,
    });

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]!;
      const slotId = randomUUID();
      let status: 'PENDING' | 'COLLECTED' | 'PARTIAL' | 'MISSED' | 'CANCELLED' =
        'PENDING';

      if (completedOn) {
        status = 'CANCELLED';
      } else if (slot.dueDate <= lastHistoryDate) {
        const onTransferLine =
          plan.transfer && slot.dueDate >= plan.transfer.on;
        const lineId = onTransferLine ? plan.transfer!.toLineId : plan.lineId;
        const lineIndex = lineIds.indexOf(lineId);
        const outstanding = A.minus(collected);
        const expected = capExpectedAmount(D, outstanding);
        const today = day(lineIndex, slot.dueDate);
        today.expected = today.expected.plus(expected);

        const behaviour = plan.behaviour(index, random);
        if (behaviour === 'MISSED') {
          status = 'MISSED';
        } else {
          // Decimal throughout (BR-11). Amounts stay whole tens of rupees, as
          // cash at the door is.
          const capped = (candidate: Money) =>
            candidate.greaterThan(outstanding) ? outstanding : candidate;
          let amount: Money = expected;
          if (behaviour === 'LOW') {
            // 40–80% of what was expected, floored to tens.
            const low = expected
              .times(random.int(4, 8))
              .dividedBy(100)
              .floor()
              .times(10);
            if (low.greaterThan(0) && low.lessThan(expected)) amount = low;
          } else if (behaviour === 'EXTRA') {
            amount = capped(expected.plus(random.int(1, 5) * 10));
          } else if (behaviour === 'NO_PAYMENT') {
            amount = toMoney('0');
          } else if (behaviour === 'MISKEYED') {
            amount = capped(expected.times(10));
          }
          const { variance, classification } = classifyCollection({
            amount,
            expectedAmount: expected,
          });
          const collector = staffOnLine(lineIndex, slot.dueDate, 'junior');
          const collectionId = randomUUID();
          collectionRows.push({
            id: collectionId,
            idempotencyKey: randomUUID(),
            accountLoanId: plan.id,
            accountScheduleId: slotId,
            lineId,
            collectedByUserId: userIds[collector]!,
            businessDate: toUtcMidnight(slot.dueDate),
            capturedAt: ist(slot.dueDate, '10:30:00'),
            syncedAt: ist(slot.dueDate, '10:30:05'),
            expectedAmount: expected.toString(),
            amount: amount.toString(),
            variance: variance.toString(),
            classification,
          });
          if (amount.greaterThan(0)) {
            const profit = profitForCollection({
              accountAmount: A,
              profitAmount: P,
              collectedBefore: collected,
              amount,
            });
            post(
              'COLLECTION',
              { table: 'collection', id: collectionId },
              slot.dueDate,
              `Collection ${plan.code}`,
              [
                { account: cashInHand[collector]!, direction: 'DEBIT', amount },
                { account: receivable, direction: 'CREDIT', amount },
                { account: unearnedProfit, direction: 'DEBIT', amount: profit },
                { account: earnedProfit, direction: 'CREDIT', amount: profit },
              ],
            );
          }
          collected = collected.plus(amount);
          today.collected = today.collected.plus(amount);
          today.byCollector.set(
            collector,
            (today.byCollector.get(collector) ?? toMoney('0')).plus(amount),
          );
          lastCollection = slot.dueDate;
          status = amount.greaterThanOrEqualTo(expected)
            ? 'COLLECTED'
            : 'PARTIAL';

          if (behaviour === 'MISKEYED') {
            // Keyed ×10; corrected the same day by an approved adjustment (BR-14).
            const correction = amount.minus(expected);
            const adjustmentId = randomUUID();
            correctedCollectionId = collectionId;
            adjustmentRows.push({
              id: adjustmentId,
              idempotencyKey: randomUUID(),
              accountLoanId: plan.id,
              lineId,
              collectedByUserId: userIds[collector]!,
              businessDate: toUtcMidnight(slot.dueDate),
              capturedAt: ist(slot.dueDate, '16:00:00'),
              syncedAt: ist(slot.dueDate, '16:00:05'),
              expectedAmount: '0',
              amount: correction.negated().toString(),
              variance: correction.negated().toString(),
              classification: 'LOW',
              entryType: 'ADJUSTMENT',
              adjustsCollectionId: collectionId,
              note: `Keyed ${amount.toString()} instead of ${expected.toString()}`,
            });
            approvalRows.push({
              collectionId: adjustmentId,
              requestedByUserId: userIds[collector]!,
              decidedByUserId:
                userIds[staffOnLine(lineIndex, slot.dueDate, 'senior')]!,
              decision: 'APPROVED',
              reason: 'Extra zero keyed at the door',
              decidedAt: ist(slot.dueDate, '17:00:00'),
            });
            const profitBack = profitForCollection({
              accountAmount: A,
              profitAmount: P,
              collectedBefore: collected,
              amount: correction.negated(),
            }).negated();
            post(
              'ADJUSTMENT',
              { table: 'collection', id: adjustmentId },
              slot.dueDate,
              `Correction ${plan.code}`,
              [
                { account: receivable, direction: 'DEBIT', amount: correction },
                {
                  account: cashInHand[collector]!,
                  direction: 'CREDIT',
                  amount: correction,
                },
                {
                  account: earnedProfit,
                  direction: 'DEBIT',
                  amount: profitBack,
                },
                {
                  account: unearnedProfit,
                  direction: 'CREDIT',
                  amount: profitBack,
                },
              ],
            );
            collected = collected.minus(correction);
            today.collected = today.collected.minus(correction);
            today.byCollector.set(
              collector,
              today.byCollector.get(collector)!.minus(correction),
            );
          }

          if (collected.greaterThanOrEqualTo(A)) completedOn = slot.dueDate;
        }
      }

      scheduleRows.push({
        id: slotId,
        accountLoanId: plan.id,
        sequence: slot.sequence,
        dueDate: toUtcMidnight(slot.dueDate),
        expectedAmount: slot.expectedAmount.toString(),
        status,
      });

      // BR-06: a shortfall leaves a balance after the last slot; the tail
      // extends — but only while there is history left to fill, or an account
      // that never clears would extend for ever.
      if (
        index === slots.length - 1 &&
        !completedOn &&
        slot.dueDate <= lastHistoryDate &&
        A.minus(collected).greaterThan(0)
      ) {
        slots = slots.concat(
          generateSchedule({
            outstanding: A.minus(collected),
            dailyAmount: D,
            after: slot.dueDate,
            holidays,
            firstSequence: slot.sequence + 1,
          }),
        );
      }
    }

    const outstanding = A.minus(collected);
    const target = completedOn
      ? completedOn
      : targetCompletionDate({
          outstanding,
          dailyAmount: D,
          after: lastCollection ?? plan.disbursement,
          holidays,
        })!;
    accountRows.push({
      id: plan.id,
      organizationId: orgId,
      accountCode: plan.code,
      customerId: plan.customerId,
      lineId: plan.lineId,
      accountAmount: A.toString(),
      investedAmount: plan.invested,
      profitAmount: P.toString(),
      dailyAmount: D.toString(),
      termDays: 100,
      disbursementDate: toUtcMidnight(plan.disbursement),
      firstCollectionDate: toUtcMidnight(
        addWorkingDays(plan.disbursement, 1, holidays),
      ),
      targetCompletionDate: toUtcMidnight(target),
      actualCompletionDate: completedOn ? toUtcMidnight(completedOn) : null,
      collectedAmount: collected.toString(),
      outstandingAmount: outstanding.toString(),
      status: completedOn ? 'COMPLETED' : 'ACTIVE',
      // BR-05 at the seeded organisation's `account.overdueGraceDays`, which
      // is the built-in default of zero: the seed writes no `setting` row, so
      // the cutoff (`accounts/overdue-cutoff.ts`) is `asOf` itself.
      isOverdue: !completedOn && target < options.asOf,
    });
    post(
      'DISBURSEMENT',
      { table: 'account_loan', id: plan.id },
      plan.disbursement,
      `Disbursement ${plan.code}`,
      [
        { account: receivable, direction: 'DEBIT', amount: A },
        {
          account: officeCash,
          direction: 'CREDIT',
          amount: toMoney(plan.invested),
        },
        { account: unearnedProfit, direction: 'CREDIT', amount: P },
      ],
    );
  }

  // --------------------------------------------------------- cash and closes
  const dayCloseRows: Prisma.DayCloseCreateManyInput[] = [];
  const handoverRows: Prisma.CashHandoverCreateManyInput[] = [];
  const denominationRows: Prisma.CashDenominationCreateManyInput[] = [];
  const discrepancyDate = workingDaysBack(5);
  const discrepancyLine = Math.min(2, options.lines - 1);
  let discrepancyDayCloseId = '';

  for (const today of [...days.values()].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  )) {
    const dayCloseId = randomUUID();
    const senior = staffOnLine(today.lineIndex, today.date, 'senior');
    let received = toMoney('0');
    for (const [junior, system] of today.byCollector) {
      if (system.lessThanOrEqualTo(0)) continue;
      const short =
        today.lineIndex === discrepancyLine &&
        today.date === discrepancyDate &&
        system.greaterThan(200);
      const declared = short ? system.minus(200) : system;
      const handoverId = randomUUID();
      handoverRows.push({
        id: handoverId,
        dayCloseId,
        fromUserId: userIds[junior]!,
        toUserId: userIds[senior]!,
        hop: 'JUNIOR_TO_SENIOR',
        // S-06: a count that differs says why.
        note: short ? 'Counted one ₹200 note short' : null,
        declaredAmount: declared.toString(),
        systemAmount: system.toString(),
        discrepancy: declared.minus(system).toString(),
        status: short ? 'DISPUTED' : 'ACKNOWLEDGED',
        acknowledgedAt: short ? null : ist(today.date, '19:00:00'),
        disputeNote: short ? 'One ₹200 note short on count' : null,
      });
      for (const { denomination, count } of notes(declared.toNumber())) {
        denominationRows.push({
          cashHandoverId: handoverId,
          denomination,
          count,
          subtotal: String(denomination * count),
        });
      }
      post(
        'HANDOVER',
        { table: 'cash_handover', id: handoverId },
        today.date,
        `Handover ${junior} → ${senior}`,
        [
          {
            account: cashInHand[senior]!,
            direction: 'DEBIT',
            amount: declared,
          },
          {
            account: cashInHand[junior]!,
            direction: 'CREDIT',
            amount: declared,
          },
        ],
      );
      received = received.plus(declared);
      if (short) discrepancyDayCloseId = dayCloseId;
    }
    const discrepancy = received.minus(today.collected);
    dayCloseRows.push({
      id: dayCloseId,
      lineId: lineIds[today.lineIndex]!,
      businessDate: toUtcMidnight(today.date),
      expectedTotal: today.expected.toString(),
      collectedTotal: today.collected.toString(),
      cashReceivedTotal: received.toString(),
      discrepancy: discrepancy.toString(),
      status: discrepancy.isZero() ? 'TALLIED' : 'CLOSED',
      closedByUserId: userIds[senior]!,
      closedAt: ist(today.date, '19:30:00'),
    });
  }

  // -------------------------------------------------------------------- write
  const inBatches = async <Row>(
    rows: Row[],
    write: (batch: Row[]) => Promise<unknown>,
  ) => {
    for (let i = 0; i < rows.length; i += 2000)
      await write(rows.slice(i, i + 2000));
  };
  await tx.accountLoan.createMany({ data: accountRows });
  await inBatches(scheduleRows, (data) =>
    tx.accountSchedule.createMany({ data }),
  );
  await inBatches(collectionRows, (data) => tx.collection.createMany({ data }));
  await tx.collection.createMany({ data: adjustmentRows });
  await tx.collectionApproval.createMany({ data: approvalRows });
  await tx.dayClose.createMany({ data: dayCloseRows });
  await inBatches(handoverRows, (data) => tx.cashHandover.createMany({ data }));
  await inBatches(denominationRows, (data) =>
    tx.cashDenomination.createMany({ data }),
  );
  await tx.ledgerAccount.createMany({ data: ledgerAccounts });
  await inBatches(transactions, (data) =>
    tx.ledgerTransaction.createMany({ data }),
  );
  await inBatches(entries, (data) => tx.ledgerEntry.createMany({ data }));

  // The balance cache (M09 reconciles it nightly): signed per normal balance.
  //  because it is one set-based UPDATE over every seeded entry;
  // the only interpolation is the id array, which Prisma parameterises.
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

  return {
    organizationId: orgId,
    staffEmails,
    counts: {
      customers: customers.length,
      accounts: accountRows.length,
      scheduleSlots: scheduleRows.length,
      collections: collectionRows.length + adjustmentRows.length,
      ledgerTransactions: transactions.length,
      ledgerEntries: entries.length,
      dayCloses: dayCloseRows.length,
      cashHandovers: handoverRows.length,
    },
    cases: {
      unevenCompletedAccountId: uneven.id,
      overdueAccountId: overdue.id,
      transferredCustomerId: transferred.customerId,
      discrepancyDayCloseId,
      correctedCollectionId,
      concurrentCustomerIds: customers
        .slice(options.customers)
        .map((c) => c.id!),
    },
  };
}
