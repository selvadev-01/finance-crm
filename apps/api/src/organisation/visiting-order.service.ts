import { Injectable } from '@nestjs/common';
import type { VisitingOrder } from '@repo/contracts';
import type { Prisma } from '@repo/db';

import { foundInScope, inScope, lineScope } from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';

const customerFields = {
  id: true,
  customerCode: true,
  name: true,
  address: true,
  routePosition: true,
} as const;

/**
 * US-040 — the order a Junior visits a line's customers in, set by the line's
 * Senior or an Admin (decided 2026-09-21). It is a place on the customer,
 * `routePosition`, unique within the line; a customer not yet placed comes
 * after the placed ones in customer-code order, so a new customer is never
 * lost — it appears at the end until someone places it. A transfer clears the
 * place (the customer is on a different route now).
 */
@Injectable()
export class VisitingOrderService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  /** The line's current customers in visiting order; out of scope is `404`. */
  async get(context: RequestContext, lineId: string): Promise<VisitingOrder> {
    const line = await this.lineInScope(this.database.client, context, lineId);
    return { customers: await this.read(this.database.client, line.id) };
  }

  /**
   * Replaces the whole order. The list must be exactly the line's current
   * customers, each once — a screen loaded before a customer joined or left
   * is refused rather than silently dropping someone from the route.
   */
  set(
    context: RequestContext,
    lineId: string,
    customerIds: readonly string[],
  ): Promise<VisitingOrder> {
    return this.database.transaction(async (tx) => {
      const line = await this.lineInScope(tx, context, lineId);
      const current = await this.read(tx, line.id);

      const known = new Set(current.map((customer) => customer.customerId));
      const given = new Set(customerIds);
      if (
        given.size !== customerIds.length ||
        given.size !== known.size ||
        customerIds.some((id) => !known.has(id))
      ) {
        throw new DomainError(
          'VISITING_ORDER_MISMATCH',
          'The order must list every customer on the line exactly once. Reload the list and try again.',
        );
      }

      // Clear first: the unique place per line is checked on every statement,
      // so swapping two customers in place would collide half-way.
      await tx.customer.updateMany({
        where: { lineId: line.id, deletedAt: null },
        data: { routePosition: null },
      });
      for (const [index, customerId] of customerIds.entries()) {
        await tx.customer.update({
          where: { id: customerId },
          data: { routePosition: index + 1 },
        });
      }

      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'line',
        entityId: line.id,
        before: { visitingOrder: placed(current) },
        after: { visitingOrder: [...customerIds] },
      });
      return { customers: await this.read(tx, line.id) };
    });
  }

  private async lineInScope(
    client: Prisma.TransactionClient,
    context: RequestContext,
    lineId: string,
  ) {
    const line = await client.line.findFirst({
      where: inScope(lineScope(context), { id: lineId }),
      select: { id: true },
    });
    return foundInScope(line, 'line');
  }

  private async read(
    client: Prisma.TransactionClient,
    lineId: string,
  ): Promise<VisitingOrder['customers']> {
    const rows = await client.customer.findMany({
      where: { lineId, deletedAt: null },
      select: customerFields,
      orderBy: [
        { routePosition: { sort: 'asc', nulls: 'last' } },
        { customerCode: 'asc' },
      ],
    });
    return rows.map((row) => ({
      customerId: row.id,
      customerCode: row.customerCode,
      name: row.name,
      address: row.address,
      position: row.routePosition,
    }));
  }
}

/** The placed customers' ids in order — what the audit row calls "before". */
function placed(customers: VisitingOrder['customers']): string[] {
  return customers
    .filter((customer) => customer.position !== null)
    .map((customer) => customer.customerId);
}
