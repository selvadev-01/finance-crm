import { Injectable } from '@nestjs/common';
import type {
  Account,
  AccountPreview,
  accountContract,
  RouteInput,
  ScheduleSlotView,
} from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  type CalendarDate,
  fromUtcMidnight,
  generateSchedule,
  type HolidaySet,
  parseCalendarDate,
  planMidTermSchedule,
  profitForCollection,
  type ScheduleSlot,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
  unearnedProfit,
} from '@repo/domain';

import {
  accountScope,
  customerScope,
  foundInScope,
  inScope,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';
import {
  type Page,
  type PageRequest,
  pageArgs,
  toPage,
} from '../platform/pagination.js';

type PreviewInput = RouteInput<typeof accountContract.previewAccount>['body'];
type CreateInput = RouteInput<typeof accountContract.createAccount>['body'];
type CloseInput = RouteInput<typeof accountContract.closeAccount>['body'];

const accountFields = {
  id: true,
  organizationId: true,
  accountCode: true,
  customerId: true,
  lineId: true,
  status: true,
  accountAmount: true,
  investedAmount: true,
  profitAmount: true,
  dailyAmount: true,
  termDays: true,
  disbursementDate: true,
  firstCollectionDate: true,
  targetCompletionDate: true,
  actualCompletionDate: true,
  collectedAmount: true,
  outstandingAmount: true,
  isOverdue: true,
  customer: { select: { name: true, sectorId: true } },
  line: { select: { name: true } },
} as const satisfies Prisma.AccountLoanSelect;

type AccountRow = Prisma.AccountLoanGetPayload<{
  select: typeof accountFields;
}>;

/** `ACC-2026-00892` — the creation year and a number that never restarts. */
export function formatAccountCode(
  year: string,
  value: bigint | number,
): string {
  return `ACC-${year}-${String(value).padStart(5, '0')}`;
}

/**
 * US-024a: what the global search box matches on an account — any part of the
 * account code, or any part of the customer's name, in either case. The code
 * carries a year (`ACC-2026-00231`), so there is no single number to match
 * exactly the way `CUS-00417` has: `contains` finds it typed whole, without
 * the year, or as its bare number. The customer relation is filtered inside
 * the account's own `accountScope`, so it widens nothing.
 */
export function accountSearchTerms(q: string): Prisma.AccountLoanWhereInput[] {
  return [
    { accountCode: { contains: q, mode: 'insensitive' } },
    { customer: { name: { contains: q, mode: 'insensitive' } } },
  ];
}

/** Decimal columns as the plain two-place strings the contract carries. */
const money = (value: Prisma.Decimal) => value.toFixed(2);

function toAccount(row: AccountRow, context: RequestContext): Account {
  // RBAC matrix, money visibility: a Junior never sees invested or profit.
  const hideMargin = context.role === 'JUNIOR';
  return {
    id: row.id,
    accountCode: row.accountCode,
    customerId: row.customerId,
    customerName: row.customer.name,
    lineId: row.lineId,
    lineName: row.line.name,
    status: row.status,
    accountAmount: money(row.accountAmount),
    investedAmount: hideMargin ? null : money(row.investedAmount),
    profitAmount: hideMargin ? null : money(row.profitAmount),
    dailyAmount: money(row.dailyAmount),
    termDays: row.termDays,
    disbursementDate: fromUtcMidnight(row.disbursementDate),
    firstCollectionDate: fromUtcMidnight(row.firstCollectionDate),
    targetCompletionDate: fromUtcMidnight(row.targetCompletionDate),
    actualCompletionDate: row.actualCompletionDate
      ? fromUtcMidnight(row.actualCompletionDate)
      : null,
    collectedAmount: money(row.collectedAmount),
    outstandingAmount: money(row.outstandingAmount),
    isOverdue: row.isOverdue,
  };
}

type Money = ReturnType<typeof toMoney>;

interface Plan {
  customer: { id: string; lineId: string; sectorId: string };
  kind: 'DAY_ONE' | 'MID_TERM';
  disbursementDate: CalendarDate;
  slots: (ScheduleSlot & { status: 'PENDING' | 'COLLECTED' | 'PARTIAL' })[];
  collected: Money;
  outstanding: Money;
  amountBehind: Money;
  firstCollectionDate: CalendarDate;
  targetCompletionDate: CalendarDate;
  holidaysSkipped: { date: CalendarDate; name: string }[];
}

/**
 * Accounts (M05) — creation (US-030), mid-term creation (US-030a), the uneven
 * final slot (US-031, from `generateSchedule`) and disbursement (US-032).
 *
 * The disbursement date decides the kind:
 * - **today or later** — a day-one account, created PENDING (or disbursed at
 *   once); a future date cannot be disbursed until the day comes.
 * - **before today** — a mid-term account, already disbursed in the world:
 *   created ACTIVE with the collected-to-date amount the Admin entered, its
 *   paid slots and regenerated tail from `planMidTermSchedule`, and both the
 *   disbursement and the catch-up posted (decided 2026-09-13).
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly ledger: LedgerService,
  ) {}

  /** S-04's live preview: exactly what `create` would store, saving nothing. */
  async preview(
    context: RequestContext,
    input: PreviewInput,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<AccountPreview> {
    const plan = await this.plan(context, input, today);
    return {
      kind: plan.kind,
      profitAmount: toMoney(input.accountAmount)
        .minus(input.investedAmount)
        .toFixed(2),
      collectedAmount: plan.collected.toFixed(2),
      outstandingAmount: plan.outstanding.toFixed(2),
      amountBehind: plan.amountBehind.toFixed(2),
      firstCollectionDate: plan.firstCollectionDate,
      targetCompletionDate: plan.targetCompletionDate,
      slotCount: plan.slots.length,
      slots: plan.slots.map((slot) => ({
        sequence: slot.sequence,
        dueDate: slot.dueDate,
        expectedAmount: slot.expectedAmount.toFixed(2),
        status: slot.status,
      })),
      holidaysSkipped: plan.holidaysSkipped,
    };
  }

  /**
   * US-030. The account and its whole schedule in one transaction, audited;
   * with `disburse`, disbursed in the same transaction (S-04 "Save and
   * disburse"). Codes come from `account_code_seq`.
   */
  create(
    context: RequestContext,
    input: CreateInput,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<Account> {
    return this.database.transaction(async (tx) => {
      const plan = await this.plan(context, input, today);
      const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`
        SELECT nextval('account_code_seq')`;
      const A = toMoney(input.accountAmount);

      const account = await tx.accountLoan.create({
        data: {
          organizationId: context.organizationId,
          accountCode: formatAccountCode(today.slice(0, 4), nextval),
          customerId: plan.customer.id,
          lineId: plan.customer.lineId,
          accountAmount: A.toFixed(2),
          investedAmount: toMoney(input.investedAmount).toFixed(2),
          profitAmount: A.minus(input.investedAmount).toFixed(2),
          dailyAmount: toMoney(input.dailyAmount).toFixed(2),
          termDays: input.termDays,
          disbursementDate: toUtcMidnight(
            parseCalendarDate(input.disbursementDate),
          ),
          firstCollectionDate: toUtcMidnight(plan.firstCollectionDate),
          targetCompletionDate: toUtcMidnight(plan.targetCompletionDate),
          status: plan.kind === 'MID_TERM' ? 'ACTIVE' : 'PENDING',
          collectedAmount: plan.collected.toFixed(2),
          outstandingAmount: plan.outstanding.toFixed(2),
          createdByUserId: context.userId,
          schedules: {
            createMany: {
              data: plan.slots.map((slot) => ({
                sequence: slot.sequence,
                dueDate: toUtcMidnight(slot.dueDate),
                expectedAmount: slot.expectedAmount.toFixed(2),
                status: slot.status,
                createdByUserId: context.userId,
              })),
            },
          },
        },
        select: {
          id: true,
          organizationId: true,
          accountCode: true,
          accountAmount: true,
          investedAmount: true,
          profitAmount: true,
        },
      });

      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'account_loan',
        entityId: account.id,
        after: {
          accountCode: account.accountCode,
          customerId: plan.customer.id,
          accountAmount: A.toFixed(2),
          investedAmount: toMoney(input.investedAmount).toFixed(2),
          dailyAmount: toMoney(input.dailyAmount).toFixed(2),
          termDays: input.termDays,
          disbursementDate: input.disbursementDate,
          slots: plan.slots.length,
          ...(plan.kind === 'MID_TERM'
            ? { midTerm: true, collectedToDate: plan.collected.toFixed(2) }
            : {}),
        },
      });

      if (plan.kind === 'MID_TERM') {
        await this.postMidTermOpening(context, account, plan, today);
        return this.get(context, account.id);
      }
      if (input.disburse) return this.disburse(context, account.id, today);
      return this.get(context, account.id);
    });
  }

  /**
   * US-032: `PENDING → ACTIVE`, and the disbursement posted to the ledger in
   * the same transaction (BR-18): debit the account's receivable `A`, credit
   * office cash `I` and unearned profit `P`.
   *
   * A PENDING account whose planned date has passed is disbursed **today**:
   * its disbursement date moves and its schedule is regenerated (still
   * allowed — nothing is collected and the amounts do not change), and the
   * audit entry records both dates.
   */
  disburse(
    context: RequestContext,
    accountId: string,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<Account> {
    return this.database.transaction(async (tx) => {
      const account = foundInScope(
        await tx.accountLoan.findFirst({
          where: inScope(accountScope(context), { id: accountId }),
          select: accountFields,
        }),
        'account',
      );
      if (account.status !== 'PENDING') {
        throw new DomainError(
          'ACCOUNT_NOT_PENDING',
          `Account ${account.accountCode} is ${account.status.toLowerCase()}; only a pending account can be disbursed`,
        );
      }
      const planned = fromUtcMidnight(account.disbursementDate);
      if (planned > today) {
        throw new DomainError(
          'DISBURSEMENT_DATE_IN_FUTURE',
          `Account ${account.accountCode} is planned for ${planned}; it can be disbursed on or after that day`,
        );
      }

      // The status change is the guard against disbursing twice: a concurrent
      // disbursement waits on this row's lock, then finds it no longer PENDING
      // and changes nothing — so it is refused here, before any ledger write.
      const claimed = await tx.accountLoan.updateMany({
        where: { id: account.id, status: 'PENDING' },
        data: { status: 'ACTIVE' },
      });
      if (claimed.count === 0) {
        throw new DomainError(
          'ACCOUNT_NOT_PENDING',
          `Account ${account.accountCode} has just been disbursed; only a pending account can be disbursed`,
        );
      }

      if (planned < today) {
        const { set: holidays } = await this.holidaysFor(
          account.organizationId,
          account.customer.sectorId,
          today,
        );
        const slots = generateSchedule({
          outstanding: account.accountAmount.toString(),
          dailyAmount: account.dailyAmount.toString(),
          after: today,
          holidays,
          firstSequence: 1,
        });
        await tx.accountSchedule.deleteMany({
          where: { accountLoanId: account.id },
        });
        await tx.accountSchedule.createMany({
          data: slots.map((slot) => ({
            accountLoanId: account.id,
            sequence: slot.sequence,
            dueDate: toUtcMidnight(slot.dueDate),
            expectedAmount: slot.expectedAmount.toFixed(2),
            createdByUserId: context.userId,
          })),
        });
        await tx.accountLoan.update({
          where: { id: account.id },
          data: {
            disbursementDate: toUtcMidnight(today),
            firstCollectionDate: toUtcMidnight(slots[0]!.dueDate),
            targetCompletionDate: toUtcMidnight(slots.at(-1)!.dueDate),
          },
        });
      }

      await this.postDisbursement(context, account, today);

      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'account_loan',
        entityId: account.id,
        before: { status: 'PENDING', disbursementDate: planned },
        after: { status: 'ACTIVE', disbursementDate: today },
      });
      return this.get(context, account.id);
    });
  }

  async list(
    context: RequestContext,
    page: PageRequest & {
      q?: string | undefined;
      customerId?: string | undefined;
      lineId?: string | undefined;
      status?: Account['status'] | undefined;
    },
  ): Promise<Page<Account>> {
    const rows = await this.database.client.accountLoan.findMany({
      where: inScope(accountScope(context), {
        ...(page.q ? { OR: accountSearchTerms(page.q) } : {}),
        ...(page.customerId ? { customerId: page.customerId } : {}),
        ...(page.lineId ? { lineId: page.lineId } : {}),
        ...(page.status ? { status: page.status } : {}),
      }),
      select: accountFields,
      ...pageArgs(page),
    });
    return toPage(rows, page, (row) => toAccount(row, context));
  }

  async get(context: RequestContext, accountId: string): Promise<Account> {
    const row = foundInScope(
      await this.database.client.accountLoan.findFirst({
        where: inScope(accountScope(context), { id: accountId }),
        select: accountFields,
      }),
      'account',
    );
    return toAccount(row, context);
  }

  async schedule(
    context: RequestContext,
    accountId: string,
  ): Promise<{ slots: ScheduleSlotView[] }> {
    const account = foundInScope(
      await this.database.client.accountLoan.findFirst({
        where: inScope(accountScope(context), { id: accountId }),
        select: {
          schedules: {
            select: {
              sequence: true,
              dueDate: true,
              expectedAmount: true,
              status: true,
            },
            orderBy: { sequence: 'asc' },
          },
        },
      }),
      'account',
    );
    return {
      slots: account.schedules.map((slot) => ({
        sequence: slot.sequence,
        dueDate: fromUtcMidnight(slot.dueDate),
        expectedAmount: money(slot.expectedAmount),
        status: slot.status,
      })),
    };
  }

  /**
   * US-030: correct a **`PENDING`** account's terms, before any money has
   * moved. After disbursement the amounts are immutable — the database says
   * so too (`constraints_account_lifecycle`) — so this is the only window in
   * which a typo can be fixed rather than written off.
   *
   * The whole plan is rebuilt from the new terms by the same code creation
   * uses, so the schedule, first collection date and target date cannot drift
   * from what a fresh account with these terms would have. The customer is
   * not changed: an account on the wrong customer is a different account.
   */
  updateTerms(
    context: RequestContext,
    accountId: string,
    input: Omit<CreateInput, 'customerId' | 'disburse'>,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<Account> {
    return this.database.transaction(async (tx) => {
      const before = foundInScope(
        await tx.accountLoan.findFirst({
          where: inScope(accountScope(context), { id: accountId }),
          select: accountFields,
        }),
        'account',
      );
      if (before.status !== 'PENDING') {
        throw new DomainError(
          'ACCOUNT_NOT_PENDING',
          `Account ${before.accountCode} is ${before.status.toLowerCase()}; terms can only be corrected before disbursement`,
        );
      }
      const disbursement = parseCalendarDate(input.disbursementDate);
      if (disbursement < today) {
        // A past date is how a mid-term account is entered (US-030a), which
        // needs the collected-to-date figure and posts to the ledger. That is
        // a new account, not a correction to a pending one.
        throw new DomainError(
          'DISBURSEMENT_DATE_IN_PAST',
          'A pending account cannot be moved to a past date; create a mid-term account instead',
          [{ field: 'disbursementDate', issue: 'is before today' }],
        );
      }

      const plan = await this.plan(
        context,
        { customerId: before.customerId, ...input },
        today,
      );
      const A = toMoney(input.accountAmount);
      await tx.accountSchedule.deleteMany({
        where: { accountLoanId: before.id },
      });
      const account = await tx.accountLoan.update({
        where: { id: before.id },
        data: {
          accountAmount: A.toFixed(2),
          investedAmount: toMoney(input.investedAmount).toFixed(2),
          profitAmount: A.minus(input.investedAmount).toFixed(2),
          dailyAmount: toMoney(input.dailyAmount).toFixed(2),
          termDays: input.termDays,
          disbursementDate: toUtcMidnight(disbursement),
          firstCollectionDate: toUtcMidnight(plan.firstCollectionDate),
          targetCompletionDate: toUtcMidnight(plan.targetCompletionDate),
          outstandingAmount: plan.outstanding.toFixed(2),
          schedules: {
            createMany: {
              data: plan.slots.map((slot) => ({
                sequence: slot.sequence,
                dueDate: toUtcMidnight(slot.dueDate),
                expectedAmount: slot.expectedAmount.toFixed(2),
                status: slot.status,
                createdByUserId: context.userId,
              })),
            },
          },
        },
        select: accountFields,
      });

      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'account_loan',
        entityId: account.id,
        before: {
          accountAmount: money(before.accountAmount),
          investedAmount: money(before.investedAmount),
          dailyAmount: money(before.dailyAmount),
          termDays: before.termDays,
          disbursementDate: fromUtcMidnight(before.disbursementDate),
        },
        after: {
          accountAmount: money(account.accountAmount),
          investedAmount: money(account.investedAmount),
          dailyAmount: money(account.dailyAmount),
          termDays: account.termDays,
          disbursementDate: input.disbursementDate,
          slots: plan.slots.length,
        },
      });
      return toAccount(account, context);
    });
  }

  /**
   * US-035: stop collecting on an account, with a mandatory reason. Super
   * Admin only (`account.close`) — writing off destroys receivable value, and
   * must not be a way for an Admin to tidy away a difficult account (M05).
   *
   * `DEFAULTED` stops collection and **leaves the money on the books**: it is
   * still owed and still chaseable, so nothing is posted. `WRITTEN_OFF` is the
   * decision that the money is gone, and posts it (decided 2026-09-20).
   */
  close(
    context: RequestContext,
    accountId: string,
    input: CloseInput,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<Account> {
    return this.database.transaction(async (tx) => {
      const inScopeAccount = foundInScope(
        await tx.accountLoan.findFirst({
          where: inScope(accountScope(context), { id: accountId }),
          select: { id: true },
        }),
        'account',
      );
      // Serialise against every other write to this account, as the collection
      // path does. The write-off credits the receivable by the outstanding
      // read here: a collection committing between the read and the posting
      // would leave the receivable negative and unearned profit with a
      // residue. The lock is held to commit, so the balances below are the
      // ones the posting uses.
      await tx.$queryRaw`SELECT id FROM account_loan WHERE id = ${inScopeAccount.id} FOR UPDATE`;
      const account = await tx.accountLoan.findUniqueOrThrow({
        where: { id: inScopeAccount.id },
        select: accountFields,
      });
      if (account.status !== 'ACTIVE') {
        throw new DomainError(
          'ACCOUNT_NOT_ACTIVE',
          `Account ${account.accountCode} is ${account.status.toLowerCase()}; only an active account can be closed`,
        );
      }

      // As at disbursement, the status change is the guard: a second closure
      // waits on this row, then finds it no longer ACTIVE and changes nothing,
      // so the write-off below is posted exactly once.
      const claimed = await tx.accountLoan.updateMany({
        where: { id: account.id, status: 'ACTIVE' },
        data: {
          status: input.status,
          closureNote: input.note,
          // BR-05: the flag belongs to an account still being collected.
          isOverdue: false,
        },
      });
      if (claimed.count === 0) {
        throw new DomainError(
          'ACCOUNT_NOT_ACTIVE',
          `Account ${account.accountCode} has just been closed`,
        );
      }
      // Nothing more is expected, so the plan stops. Answered slots are
      // history and are never touched.
      await tx.accountSchedule.updateMany({
        where: { accountLoanId: account.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      if (input.status === 'WRITTEN_OFF') {
        await this.postWriteOff(context, account, today);
      }

      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'account_loan',
        entityId: account.id,
        before: { status: account.status },
        after: {
          status: input.status,
          closureNote: input.note,
          // Only a write-off gives money up; DEFAULTED leaves it owed.
          ...(input.status === 'WRITTEN_OFF'
            ? { writtenOff: money(account.outstandingAmount) }
            : {}),
        },
      });

      const closed = await tx.accountLoan.findUniqueOrThrow({
        where: { id: account.id },
        select: accountFields,
      });
      return toAccount(closed, context);
    });
  }

  /**
   * The write-off (M09): clear what the account still owes and the profit
   * never earned on it, and carry the difference — the money the business
   * actually put out and did not get back — to `WRITE_OFF_LOSS`.
   *
   * Outstanding `O` and unearned profit `U` come from the same figures BR-18
   * posts on every collection, so the three lines balance exactly: credit the
   * receivable `O`, debit unearned profit `U`, debit the loss `O − U`.
   */
  private async postWriteOff(
    context: RequestContext,
    account: AccountRow,
    businessDate: CalendarDate,
  ): Promise<void> {
    const outstanding = toMoney(account.outstandingAmount.toString());
    if (outstanding.isZero()) return;

    const unearned = unearnedProfit({
      accountAmount: account.accountAmount.toString(),
      profitAmount: account.profitAmount.toString(),
      collected: account.collectedAmount.toString(),
    });
    const receivable = await this.ledger.receivableFor(account.id);
    const unearnedAccount = await this.ledger.organizationAccount(
      account.organizationId,
      'UNEARNED_PROFIT',
    );
    const loss = await this.ledger.organizationAccount(
      account.organizationId,
      'WRITE_OFF_LOSS',
    );
    await this.ledger.post(context, {
      transactionType: 'WRITE_OFF',
      source: { table: 'account_loan', id: account.id },
      businessDate,
      eventAt: new Date(),
      description: `Write-off ${account.accountCode}`,
      lines: [
        {
          ledgerAccountId: receivable,
          direction: 'CREDIT',
          amount: outstanding.toFixed(2),
        },
        {
          ledgerAccountId: unearnedAccount,
          direction: 'DEBIT',
          amount: unearned.toFixed(2),
        },
        {
          ledgerAccountId: loss,
          direction: 'DEBIT',
          amount: outstanding.minus(unearned).toFixed(2),
        },
      ],
    });
  }

  /**
   * BR-18's disbursement on `businessDate`: debit the account's new receivable
   * `A`, credit office cash `I` and unearned profit `P`.
   */
  private async postDisbursement(
    context: RequestContext,
    account: {
      id: string;
      organizationId: string;
      accountCode: string;
      accountAmount: Prisma.Decimal;
      investedAmount: Prisma.Decimal;
      profitAmount: Prisma.Decimal;
    },
    businessDate: CalendarDate,
  ): Promise<{ receivable: string; officeCash: string; unearned: string }> {
    const receivable = await this.ledger.createReceivable(
      account.organizationId,
      account.id,
    );
    const officeCash = await this.ledger.organizationAccount(
      account.organizationId,
      'CASH_AT_OFFICE',
    );
    const unearned = await this.ledger.organizationAccount(
      account.organizationId,
      'UNEARNED_PROFIT',
    );
    await this.ledger.post(context, {
      transactionType: 'DISBURSEMENT',
      source: { table: 'account_loan', id: account.id },
      businessDate,
      eventAt: new Date(),
      description: `Disbursement ${account.accountCode}`,
      lines: [
        {
          ledgerAccountId: receivable,
          direction: 'DEBIT',
          amount: money(account.accountAmount),
        },
        {
          ledgerAccountId: officeCash,
          direction: 'CREDIT',
          amount: money(account.investedAmount),
        },
        {
          ledgerAccountId: unearned,
          direction: 'CREDIT',
          amount: money(account.profitAmount),
        },
      ],
    });
    return { receivable, officeCash, unearned };
  }

  /**
   * US-030a: a mid-term account's ledger balances from its first day. The
   * disbursement is posted on the original disbursement date; the money paid
   * before Rasi is one catch-up COLLECTION on the entry day — debit office cash
   * (it is back in the business, not in any Junior's hand; decided 2026-09-13),
   * credit the receivable, and move the profit it earned from unearned to
   * earned with `profitForCollection` from zero, which is exactly what a
   * day-one account's collections would have recognised (BR-18).
   */
  private async postMidTermOpening(
    context: RequestContext,
    account: Parameters<AccountService['postDisbursement']>[1],
    plan: Plan,
    today: CalendarDate,
  ): Promise<void> {
    const { receivable, officeCash, unearned } = await this.postDisbursement(
      context,
      account,
      plan.disbursementDate,
    );
    if (plan.collected.isZero()) return;

    const earned = await this.ledger.organizationAccount(
      account.organizationId,
      'EARNED_PROFIT',
    );
    const profit = profitForCollection({
      accountAmount: account.accountAmount.toString(),
      profitAmount: account.profitAmount.toString(),
      collectedBefore: '0',
      amount: plan.collected,
    });
    await this.ledger.post(context, {
      transactionType: 'COLLECTION',
      source: { table: 'account_loan', id: account.id },
      businessDate: today,
      eventAt: new Date(),
      description: `Collected before Rasi ${account.accountCode}`,
      lines: [
        {
          ledgerAccountId: officeCash,
          direction: 'DEBIT',
          amount: plan.collected.toFixed(2),
        },
        {
          ledgerAccountId: receivable,
          direction: 'CREDIT',
          amount: plan.collected.toFixed(2),
        },
        {
          ledgerAccountId: unearned,
          direction: 'DEBIT',
          amount: profit.toFixed(2),
        },
        {
          ledgerAccountId: earned,
          direction: 'CREDIT',
          amount: profit.toFixed(2),
        },
      ],
    });
  }

  /**
   * Everything `preview` and `create` share: the customer is in scope, may be
   * given an account, and sits on an active line; the kind follows from the
   * date; and the schedule, from `packages/domain` with the sector's holidays.
   */
  private async plan(
    context: RequestContext,
    input: PreviewInput,
    today: CalendarDate,
  ): Promise<Plan> {
    const customer = foundInScope(
      await this.database.client.customer.findFirst({
        where: inScope(customerScope(context), {
          id: input.customerId,
          deletedAt: null,
        }),
        select: {
          id: true,
          status: true,
          lineId: true,
          sectorId: true,
          line: { select: { isActive: true } },
        },
      }),
      'customer',
    );
    if (customer.status === 'BLACKLISTED') {
      throw new DomainError(
        'CUSTOMER_BLACKLISTED',
        'This customer is blacklisted and cannot be given a new account',
        [{ field: 'customerId', issue: 'is blacklisted' }],
      );
    }
    if (!customer.line.isActive) {
      throw new DomainError(
        'LINE_INACTIVE',
        "The customer's line is inactive, so it takes no new accounts",
      );
    }
    const disbursementDate = parseCalendarDate(input.disbursementDate);
    const midTerm = disbursementDate < today;
    if (midTerm && input.collectedToDate === undefined) {
      throw new DomainError(
        'COLLECTED_TO_DATE_REQUIRED',
        'A past disbursement date is a mid-term account: enter what the customer has paid so far, from their collection note',
        [
          {
            field: 'collectedToDate',
            issue: 'is required for a past disbursement date',
          },
        ],
      );
    }
    if (
      !midTerm &&
      input.collectedToDate !== undefined &&
      !toMoney(input.collectedToDate).isZero()
    ) {
      throw new DomainError(
        'COLLECTED_TO_DATE_NOT_ALLOWED',
        'Collected to date is only entered for a mid-term account, whose disbursement date is in the past',
        [
          {
            field: 'collectedToDate',
            issue: 'is only for a past disbursement date',
          },
        ],
      );
    }

    const holidays = await this.holidaysFor(
      context.organizationId,
      customer.sectorId,
      disbursementDate,
    );
    const customerPart = {
      id: customer.id,
      lineId: customer.lineId,
      sectorId: customer.sectorId,
    };
    const skippedUntil = (last: CalendarDate) =>
      holidays.named.filter(
        (holiday) => holiday.date > disbursementDate && holiday.date <= last,
      );

    if (midTerm) {
      const plan = planMidTermSchedule({
        accountAmount: input.accountAmount,
        dailyAmount: input.dailyAmount,
        disbursementDate,
        enteredOn: today,
        collectedToDate: input.collectedToDate!,
        holidays: holidays.set,
      });
      return {
        customer: customerPart,
        kind: 'MID_TERM',
        disbursementDate,
        slots: plan.slots,
        collected: toMoney(input.collectedToDate!),
        outstanding: plan.outstanding,
        amountBehind: plan.amountBehind,
        firstCollectionDate: plan.firstCollectionDate,
        targetCompletionDate: plan.targetCompletionDate,
        holidaysSkipped: skippedUntil(plan.targetCompletionDate),
      };
    }

    const slots = generateSchedule({
      outstanding: input.accountAmount,
      dailyAmount: input.dailyAmount,
      after: disbursementDate,
      holidays: holidays.set,
      firstSequence: 1,
    }).map((slot) => ({ ...slot, status: 'PENDING' as const }));
    const last = slots.at(-1)!.dueDate;
    return {
      customer: customerPart,
      kind: 'DAY_ONE',
      disbursementDate,
      slots,
      collected: toMoney('0'),
      outstanding: toMoney(input.accountAmount),
      amountBehind: toMoney('0'),
      firstCollectionDate: slots[0]!.dueDate,
      targetCompletionDate: last,
      holidaysSkipped: skippedUntil(last),
    };
  }

  /**
   * M06: the holidays a sector observes after `from` — business-wide rows plus
   * its own. Resolved here, once; the arithmetic never sees a sector.
   */
  private async holidaysFor(
    organizationId: string,
    sectorId: string,
    from: CalendarDate,
  ): Promise<{
    set: HolidaySet;
    named: { date: CalendarDate; name: string }[];
  }> {
    const rows = await this.database.client.holiday.findMany({
      where: {
        organizationId,
        date: { gt: toUtcMidnight(from) },
        OR: [{ sectorId: null }, { sectorId }],
      },
      select: { date: true, name: true },
      orderBy: { date: 'asc' },
    });
    const named = rows.map((row) => ({
      date: fromUtcMidnight(row.date),
      name: row.name,
    }));
    return { set: new Set(named.map((holiday) => holiday.date)), named };
  }
}
