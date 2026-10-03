import { Injectable } from '@nestjs/common';
import type { Expense } from '@repo/contracts';
import {
  type CalendarDate,
  fromUtcMidnight,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import {
  expenseScope,
  foundInScope,
  inScope,
  isOwnLine,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { DayCloseService } from '../cash/day-close.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { EventNotices } from '../notifications/event-notices.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  AuthorizationError,
  ConflictError,
  DomainError,
} from '../platform/errors/errors.js';
import { BooksMoneyService, mayDecideExpense } from './books-money.service.js';

/**
 * Books slice 3 (ADR-0018): field expenses — petrol, a tea for a customer's
 * family — paid from cash collected on the round.
 *
 * - **Requested** by a Junior or a Senior for one of their current lines,
 *   today (they name it when they work several). It
 *   waits `PENDING` and posts nothing; the hop it comes out of is fixed now,
 *   from the spender's role, so a later promotion never moves it.
 * - **Decided** by someone else (decided 2026-09-24): a Junior's by the line's
 *   Senior or an Admin, a Senior's by an Admin only. No amount cap — the
 *   approval is the control.
 * - **Approval posts** DR the category's EXPENSE / CR the spender's
 *   CASH_IN_HAND, so their cash in hand falls by what they spent; the handover
 *   then expects that much less, and the line's day counts it beside the cash
 *   received. A rejection posts nothing and the cash is still owed.
 *
 * Deciding re-tallies the line's day if it has a close (`refreshTally`): it
 * does not reopen it, because no recorded money changed.
 */
@Injectable()
export class FieldExpenseService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly ledger: LedgerService,
    private readonly money: BooksMoneyService,
    private readonly dayCloses: DayCloseService,
    private readonly notices: EventNotices,
  ) {}

  async request(
    context: RequestContext,
    input: {
      categoryId: string;
      amount: string;
      note: string;
      lineId?: string | undefined;
    },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<Expense> {
    const lineId = spentOn(context, input.lineId);
    const hop =
      context.role === 'JUNIOR' ? 'JUNIOR_TO_SENIOR' : 'SENIOR_TO_OFFICE';
    const amount = toMoney(input.amount).toFixed(2);
    const id = await this.database.transaction(async (tx) => {
      const category = await this.money.activeCategory(
        tx,
        context,
        input.categoryId,
      );
      const line = await tx.line.findFirstOrThrow({
        where: { id: lineId, organizationId: context.organizationId },
        select: { name: true },
      });
      const row = await tx.expense.create({
        data: {
          organizationId: context.organizationId,
          expenseCategoryId: category.id,
          amount,
          businessDate: toUtcMidnight(today),
          note: input.note,
          paidFrom: 'CASH_IN_HAND',
          spenderUserId: context.userId,
          lineId,
          hop,
          status: 'PENDING',
          createdByUserId: context.userId,
        },
        select: { id: true },
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'expense',
        entityId: row.id,
        after: {
          category: category.name,
          amount,
          businessDate: today,
          paidFrom: 'CASH_IN_HAND',
          hop,
          note: input.note,
        },
      });
      await this.notices.expenseRequested({
        actorUserId: context.userId,
        organizationId: context.organizationId,
        lineId,
        lineName: line.name,
        hop,
        category: category.name,
        amount,
        note: input.note,
      });
      return row.id;
    });
    return this.money.getExpense(context, id);
  }

  async decide(
    context: RequestContext,
    expenseId: string,
    input: { decision: 'APPROVED' | 'REJECTED'; note?: string | undefined },
    now: Date = new Date(),
  ): Promise<Expense> {
    await this.database.transaction(async (tx) => {
      foundInScope(
        await tx.expense.findFirst({
          where: inScope(expenseScope(context), { id: expenseId }),
          select: { id: true },
        }),
        'expense',
      );
      await tx.$queryRaw`SELECT id FROM expense WHERE id = ${expenseId} FOR UPDATE`;
      const row = await tx.expense.findUniqueOrThrow({
        where: { id: expenseId },
        select: {
          id: true,
          amount: true,
          businessDate: true,
          note: true,
          paidFrom: true,
          status: true,
          spenderUserId: true,
          hop: true,
          lineId: true,
          expenseCategory: { select: { id: true, name: true } },
        },
      });
      if (row.paidFrom !== 'CASH_IN_HAND') {
        throw new DomainError(
          'EXPENSE_NOT_FIELD',
          'Only a field expense waits for a decision',
        );
      }
      if (row.status !== 'PENDING') {
        throw new ConflictError(
          'EXPENSE_ALREADY_DECIDED',
          `This expense is already ${row.status.toLowerCase()}`,
        );
      }
      if (row.spenderUserId === context.userId) {
        throw new AuthorizationError(
          'OWN_EXPENSE',
          'You spent this, so someone else must decide it',
        );
      }
      if (!mayDecideExpense(context, row)) {
        throw new AuthorizationError(
          'EXPENSE_NEEDS_ADMIN',
          "A Senior's own field expense is decided by an Admin",
        );
      }

      const approved = input.decision === 'APPROVED';
      const amount = toMoney(row.amount.toString()).toFixed(2);
      const businessDate = fromUtcMidnight(row.businessDate);
      await tx.expense.update({
        where: { id: row.id },
        data: {
          status: input.decision,
          decidedByUserId: context.userId,
          decidedAt: now,
          decisionNote: input.note ?? null,
        },
      });
      if (approved) {
        await this.ledger.post(context, {
          transactionType: 'EXPENSE',
          source: { table: 'expense', id: row.id },
          businessDate,
          eventAt: now,
          description: `${row.expenseCategory.name} (field): ${row.note}`,
          lines: [
            {
              ledgerAccountId: await this.ledger.expenseAccount(
                context.organizationId,
                row.expenseCategory.id,
              ),
              direction: 'DEBIT',
              amount,
            },
            {
              ledgerAccountId: await this.ledger.cashInHand(
                context.organizationId,
                row.spenderUserId!,
              ),
              direction: 'CREDIT',
              amount,
            },
          ],
        });
      }
      const day = await tx.dayClose.findUnique({
        where: {
          lineId_businessDate: {
            lineId: row.lineId!,
            businessDate: row.businessDate,
          },
        },
        select: { id: true },
      });
      if (day) {
        await tx.$queryRaw`SELECT id FROM day_close WHERE id = ${day.id} FOR UPDATE`;
        await this.dayCloses.refreshTally(tx, day.id);
      }
      await this.audit.record(context, {
        action: approved ? 'APPROVE' : 'REJECT',
        entityTable: 'expense',
        entityId: row.id,
        before: { status: 'PENDING' },
        after: { status: input.decision, amount, note: input.note ?? null },
      });
      await this.notices.expenseDecided({
        actorUserId: context.userId,
        spenderUserId: row.spenderUserId!,
        expenseId: row.id,
        approved,
        category: row.expenseCategory.name,
        amount,
        note: input.note ?? null,
      });
    });
    return this.money.getExpense(context, expenseId);
  }
}

/**
 * The line a field expense is charged to: the one named, which must be one of
 * the spender's lines today, or their only line. A Senior or Junior on several
 * lines (decided 2026-10-03) must say which — the expense comes out of that
 * line's handover.
 */
function spentOn(context: RequestContext, lineId: string | undefined): string {
  const lines = context.currentLineIds;
  if (lines.length === 0) {
    throw new DomainError(
      'NOT_ON_A_LINE',
      'You are not assigned to a line today, so there is no round to spend for',
    );
  }
  if (lineId === undefined) {
    if (lines.length === 1) return lines[0]!;
    throw new DomainError(
      'LINE_REQUIRED',
      'You work more than one line today; choose the line you spent this on',
      [{ field: 'lineId', issue: 'is required when you work several lines' }],
    );
  }
  return foundInScope(isOwnLine(context, lineId) ? lineId : null, 'line');
}
