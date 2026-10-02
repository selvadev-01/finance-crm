import { Injectable } from '@nestjs/common';
import type { ExpenseCategory } from '@repo/contracts';

import {
  expenseCategoryScope,
  foundInScope,
  inScope,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { isUniqueViolation } from '../organisation/prisma-errors.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ConflictError } from '../platform/errors/errors.js';

/** What every organization starts with (ADR-0018, decided 2026-09-24). */
export const STARTER_EXPENSE_CATEGORIES = [
  'Salary',
  'Rent',
  'Fuel & travel',
  'Phone & internet',
  'Stationery & printing',
  'Bank charges',
  'Interest paid',
  'Miscellaneous',
] as const;

const fields = { id: true, name: true, isActive: true } as const;

const nameTaken = (name: string) =>
  new ConflictError(
    'EXPENSE_CATEGORY_NAME_TAKEN',
    `There is already an expense category called ${name}`,
    [{ field: 'name', issue: 'is already a category' }],
  );

/**
 * Expense categories (ADR-0018): a starter list the Super Admin adds to,
 * renames and retires. **Never deleted** — a category that has been spent
 * against keeps its EXPENSE ledger account, and the foreign key refuses it.
 */
@Injectable()
export class ExpenseCategoryService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  async list(
    context: RequestContext,
    query: { includeRetired: boolean },
  ): Promise<{ data: ExpenseCategory[] }> {
    const rows = await this.database.client.expenseCategory.findMany({
      where: inScope(
        expenseCategoryScope(context),
        query.includeRetired ? {} : { isActive: true },
      ),
      select: fields,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return { data: rows };
  }

  async create(
    context: RequestContext,
    input: { name: string },
  ): Promise<ExpenseCategory> {
    try {
      return await this.database.transaction(async (tx) => {
        const row = await tx.expenseCategory.create({
          data: {
            organizationId: context.organizationId,
            name: input.name,
            createdByUserId: context.userId,
          },
          select: fields,
        });
        await this.audit.record(context, {
          action: 'CREATE',
          entityTable: 'expense_category',
          entityId: row.id,
          after: { name: row.name },
        });
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken(input.name);
      throw error;
    }
  }

  async update(
    context: RequestContext,
    categoryId: string,
    input: { name: string; isActive: boolean },
  ): Promise<ExpenseCategory> {
    try {
      return await this.database.transaction(async (tx) => {
        const before = foundInScope(
          await tx.expenseCategory.findFirst({
            where: inScope(expenseCategoryScope(context), { id: categoryId }),
            select: fields,
          }),
          'expense category',
        );
        const row = await tx.expenseCategory.update({
          where: { id: before.id },
          data: { name: input.name, isActive: input.isActive },
          select: fields,
        });
        await this.audit.record(context, {
          action: 'UPDATE',
          entityTable: 'expense_category',
          entityId: row.id,
          before: { name: before.name, isActive: before.isActive },
          after: { name: row.name, isActive: row.isActive },
        });
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken(input.name);
      throw error;
    }
  }
}
