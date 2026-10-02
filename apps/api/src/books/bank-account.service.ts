import { Injectable } from '@nestjs/common';
import type { BankAccountView } from '@repo/contracts';
import { toMoney } from '@repo/domain';

import { bankAccountScope, foundInScope, inScope } from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { isUniqueViolation } from '../organisation/prisma-errors.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ConflictError, DomainError } from '../platform/errors/errors.js';

const fields = {
  id: true,
  name: true,
  last4: true,
  isActive: true,
  ledgerAccounts: { where: { accountType: 'BANK' }, select: { balance: true } },
} as const;

type Row = {
  id: string;
  name: string;
  last4: string | null;
  isActive: boolean;
  ledgerAccounts: { balance: { toString(): string } }[];
};

const nameTaken = (name: string) =>
  new ConflictError(
    'BANK_ACCOUNT_NAME_TAKEN',
    `There is already a bank account called ${name}`,
    [{ field: 'name', issue: 'is already a bank account' }],
  );

function toView(row: Row): BankAccountView {
  const balance = row.ledgerAccounts[0]?.balance.toString() ?? '0';
  return {
    id: row.id,
    name: row.name,
    last4: row.last4,
    isActive: row.isActive,
    balance: toMoney(balance).toFixed(2),
  };
}

/**
 * The business's bank accounts (ADR-0018). The Super Admin adds, renames and
 * retires them; each one's money is a BANK ledger account, created on first
 * movement. **Never deleted**, and not retired while money is still in it —
 * money in a retired account could no longer be moved out.
 */
@Injectable()
export class BankAccountService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  async list(
    context: RequestContext,
    query: { includeRetired: boolean },
  ): Promise<{ data: BankAccountView[] }> {
    const rows = await this.database.client.bankAccount.findMany({
      where: inScope(
        bankAccountScope(context),
        query.includeRetired ? {} : { isActive: true },
      ),
      select: fields,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return { data: rows.map(toView) };
  }

  async create(
    context: RequestContext,
    input: { name: string; last4?: string | undefined },
  ): Promise<BankAccountView> {
    try {
      return await this.database.transaction(async (tx) => {
        const row = await tx.bankAccount.create({
          data: {
            organizationId: context.organizationId,
            name: input.name,
            last4: input.last4 ?? null,
            createdByUserId: context.userId,
          },
          select: fields,
        });
        await this.audit.record(context, {
          action: 'CREATE',
          entityTable: 'bank_account',
          entityId: row.id,
          after: { name: row.name, last4: row.last4 },
        });
        return toView(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken(input.name);
      throw error;
    }
  }

  async update(
    context: RequestContext,
    bankAccountId: string,
    input: { name: string; last4?: string | undefined; isActive: boolean },
  ): Promise<BankAccountView> {
    try {
      return await this.database.transaction(async (tx) => {
        // Held to commit, against `BooksMoneyService.place`'s `FOR SHARE`: a
        // movement into this bank either commits first — and the balance read
        // below includes it — or waits and then finds the bank retired. Without
        // it a bank could be retired holding money (ADR-0018).
        await tx.$queryRaw`SELECT id FROM bank_account WHERE id = ${bankAccountId} FOR UPDATE`;
        const before = foundInScope(
          await tx.bankAccount.findFirst({
            where: inScope(bankAccountScope(context), { id: bankAccountId }),
            select: fields,
          }),
          'bank account',
        );
        const balance = toMoney(toView(before).balance);
        if (before.isActive && !input.isActive && !balance.isZero()) {
          throw new DomainError(
            'BANK_ACCOUNT_HAS_BALANCE',
            `${before.name} still holds ₹${balance.toFixed(2)}; move it out before retiring the account`,
          );
        }
        const row = await tx.bankAccount.update({
          where: { id: before.id },
          data: {
            name: input.name,
            last4: input.last4 ?? null,
            isActive: input.isActive,
          },
          select: fields,
        });
        await this.audit.record(context, {
          action: 'UPDATE',
          entityTable: 'bank_account',
          entityId: row.id,
          before: {
            name: before.name,
            last4: before.last4,
            isActive: before.isActive,
          },
          after: { name: row.name, last4: row.last4, isActive: row.isActive },
        });
        return toView(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken(input.name);
      throw error;
    }
  }
}
