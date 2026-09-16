import { Injectable } from '@nestjs/common';
import type { Handover } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import { fromUtcMidnight, toMoney } from '@repo/domain';

import { roleHasPermission } from '../access/permissions.js';
import type { RequestContext } from '../platform/context/request-context.js';

type Tx = Prisma.TransactionClient;

export const handoverSelect = {
  id: true,
  hop: true,
  fromUserId: true,
  toUserId: true,
  declaredAmount: true,
  systemAmount: true,
  discrepancy: true,
  status: true,
  note: true,
  disputeNote: true,
  createdAt: true,
  acknowledgedAt: true,
  dayClose: {
    select: {
      lineId: true,
      businessDate: true,
      line: { select: { name: true } },
    },
  },
  denominations: {
    select: { denomination: true, count: true, subtotal: true },
    orderBy: { denomination: 'desc' },
  },
} satisfies Prisma.CashHandoverSelect;

export type HandoverRow = Prisma.CashHandoverGetPayload<{
  select: typeof handoverSelect;
}>;

/**
 * Handover rows as the API shows them (S-05, S-06), with what the caller may
 * do. Reads only; the caller has already applied scope.
 */
@Injectable()
export class HandoverViews {
  async toViews(
    tx: Tx,
    context: RequestContext,
    rows: HandoverRow[],
  ): Promise<Handover[]> {
    const ids = [
      ...new Set(rows.flatMap((row) => [row.fromUserId, row.toUserId])),
    ];
    const users = ids.length
      ? await tx.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((user) => [user.id, user.name]));
    const admin = context.role === 'ADMIN' || context.role === 'SUPER_ADMIN';
    return rows.map((row) => ({
      id: row.id,
      hop: row.hop,
      lineId: row.dayClose.lineId,
      lineName: row.dayClose.line.name,
      businessDate: fromUtcMidnight(row.dayClose.businessDate),
      fromUserId: row.fromUserId,
      fromName: names.get(row.fromUserId) ?? 'Unknown staff',
      toUserId: row.toUserId,
      toName: names.get(row.toUserId) ?? 'Unknown staff',
      declaredAmount: toMoney(row.declaredAmount.toString()).toFixed(2),
      systemAmount: toMoney(row.systemAmount.toString()).toFixed(2),
      discrepancy: toMoney(row.discrepancy.toString()).toFixed(2),
      status: row.status,
      note: row.note,
      disputeNote: row.disputeNote,
      createdAt: row.createdAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      denominations: row.denominations.map((d) => ({
        denomination: d.denomination,
        count: d.count,
        subtotal: toMoney(d.subtotal.toString()).toFixed(2),
      })),
      canAcknowledge:
        row.status === 'PENDING' &&
        row.toUserId === context.userId &&
        roleHasPermission(context.role, 'handover.acknowledge'),
      canDispute:
        row.status === 'PENDING' &&
        roleHasPermission(context.role, 'handover.dispute') &&
        (admin ||
          row.fromUserId === context.userId ||
          row.toUserId === context.userId),
    }));
  }

  /** Every handover of a line's day, newest first. */
  async forDay(
    tx: Tx,
    context: RequestContext,
    dayCloseId: string | null,
  ): Promise<Handover[]> {
    if (!dayCloseId) return [];
    const rows = await tx.cashHandover.findMany({
      where: { dayCloseId },
      select: handoverSelect,
      orderBy: { createdAt: 'desc' },
    });
    return this.toViews(tx, context, rows);
  }
}
