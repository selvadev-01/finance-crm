import { Injectable } from '@nestjs/common';
import type {
  CustomerDetail,
  CustomerLinePeriod,
  CustomerSummary,
  RouteInput,
} from '@repo/contracts';
import { customerContract, mobileSchema } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  type CalendarDate,
  fromUtcMidnight,
  toBusinessDate,
  toUtcMidnight,
} from '@repo/domain';

import {
  customerScope,
  foundInScope,
  inScope,
  lineScope,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { EventNotices } from '../notifications/event-notices.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ConflictError, DomainError } from '../platform/errors/errors.js';
import {
  type Page,
  type PageRequest,
  pageArgs,
  toPage,
} from '../platform/pagination.js';

type CreateInput = RouteInput<typeof customerContract.createCustomer>['body'];
type UpdateInput = RouteInput<typeof customerContract.updateCustomer>['body'];
type TransferInput = RouteInput<
  typeof customerContract.transferCustomer
>['body'];

const summaryFields = {
  id: true,
  customerCode: true,
  name: true,
  mobile: true,
  status: true,
  lineId: true,
  sectorId: true,
  line: { select: { name: true } },
} as const satisfies Prisma.CustomerSelect;

const detailFields = {
  ...summaryFields,
  alternateMobile: true,
  address: true,
  notes: true,
  sector: { select: { name: true } },
  references: {
    select: {
      id: true,
      name: true,
      mobile: true,
      relation: true,
      address: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const satisfies Prisma.CustomerSelect;

type SummaryRow = Prisma.CustomerGetPayload<{ select: typeof summaryFields }>;
type DetailRow = Prisma.CustomerGetPayload<{ select: typeof detailFields }>;

function toSummary(row: SummaryRow): CustomerSummary {
  return {
    id: row.id,
    customerCode: row.customerCode,
    name: row.name,
    mobile: row.mobile,
    status: row.status,
    lineId: row.lineId,
    lineName: row.line.name,
    sectorId: row.sectorId,
  };
}

function toDetail(row: DetailRow): CustomerDetail {
  return {
    ...toSummary(row),
    alternateMobile: row.alternateMobile,
    address: row.address,
    notes: row.notes,
    sectorName: row.sector.name,
    references: row.references,
  };
}

/** `CUS-00417` — five digits, growing past them rather than wrapping. */
export function formatCustomerCode(value: bigint | number): string {
  return `CUS-${String(value).padStart(5, '0')}`;
}

/**
 * Customers (M04). Every method takes the caller's context and filters with
 * `customerScope` (M02): Admins their organization, a Senior their line, a
 * Junior their line's customers (decided 2026-09-13).
 */
@Injectable()
export class CustomerService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly notices: EventNotices,
  ) {}

  async list(
    context: RequestContext,
    page: PageRequest & {
      q?: string | undefined;
      lineId?: string | undefined;
      mobile?: string | undefined;
      status?: CustomerSummary['status'] | undefined;
    },
  ): Promise<Page<CustomerSummary>> {
    const rows = await this.database.client.customer.findMany({
      where: inScope(customerScope(context), {
        deletedAt: null,
        ...(page.q ? { OR: searchTerms(page.q) } : {}),
        ...(page.lineId ? { lineId: page.lineId } : {}),
        ...(page.mobile ? { mobile: page.mobile } : {}),
        ...(page.status ? { status: page.status } : {}),
      }),
      select: summaryFields,
      ...pageArgs(page),
    });
    return toPage(rows, page, toSummary);
  }

  async get(
    context: RequestContext,
    customerId: string,
  ): Promise<CustomerDetail> {
    const row = foundInScope(
      await this.database.client.customer.findFirst({
        where: inScope(customerScope(context), {
          id: customerId,
          deletedAt: null,
        }),
        select: detailFields,
      }),
      'customer',
    );
    return toDetail(row);
  }

  /**
   * US-020. The line must be one the caller can see (else `404`) and active
   * (`422 LINE_INACTIVE`); the sector is copied from it. A mobile already on
   * another of the organization's customers is `409 DUPLICATE_MOBILE` unless
   * confirmed — a warning, not a rule (M04), so it is checked before any
   * write and never enforced by the database.
   */
  create(
    context: RequestContext,
    input: CreateInput,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<CustomerDetail> {
    return this.database.transaction(async (tx) => {
      const line = foundInScope(
        await tx.line.findFirst({
          where: inScope(lineScope(context), { id: input.lineId }),
          select: { id: true, sectorId: true, isActive: true },
        }),
        'line',
      );
      if (!line.isActive) {
        throw new DomainError(
          'LINE_INACTIVE',
          'Customers cannot be added to an inactive line',
          [{ field: 'lineId', issue: 'is inactive' }],
        );
      }

      if (!input.confirmDuplicateMobile) {
        await assertMobileUnshared(tx, context, input.mobile);
      }

      const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`
        SELECT nextval('customer_code_seq')`;

      const customer = await tx.customer.create({
        data: {
          organizationId: context.organizationId,
          customerCode: formatCustomerCode(nextval),
          name: input.name,
          mobile: input.mobile,
          alternateMobile: input.alternateMobile ?? null,
          address: input.address,
          lineId: line.id,
          sectorId: line.sectorId,
          notes: input.notes ?? null,
          createdByUserId: context.userId,
          // The open period is this customer's line from today (US-023). It is
          // what the collection path reads, so every customer has one.
          linePeriods: {
            create: {
              lineId: line.id,
              effectiveFrom: toUtcMidnight(today),
              createdByUserId: context.userId,
            },
          },
          references: {
            create: input.references.map((reference) => ({
              name: reference.name,
              mobile: reference.mobile,
              relation: reference.relation ?? null,
              address: reference.address ?? null,
              createdByUserId: context.userId,
            })),
          },
        },
        select: detailFields,
      });

      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'customer',
        entityId: customer.id,
        after: {
          customerCode: customer.customerCode,
          lineId: customer.lineId,
          references: customer.references.length,
          duplicateMobileConfirmed: input.confirmDuplicateMobile,
        },
      });
      // US-020, §12: the line's Senior hears who has joined their round, in
      // this transaction — no customer, no notice.
      await this.notices.customerOnboarded({
        actorUserId: context.userId,
        customerId: customer.id,
        customerCode: customer.customerCode,
        customerName: customer.name,
        lineId: customer.lineId,
        lineName: customer.line.name,
      });
      return toDetail(customer);
    });
  }

  /**
   * US-021. The customer must be one the caller can see (else `404`). A
   * reference `id` that is not this customer's is `422 UNKNOWN_REFERENCE`,
   * never a way to touch another customer's row. The duplicate-mobile warning
   * applies only when the mobile changes, and never counts the customer
   * itself. The line is untouched — that is a transfer (US-023).
   */
  update(
    context: RequestContext,
    customerId: string,
    input: UpdateInput,
  ): Promise<CustomerDetail> {
    return this.database.transaction(async (tx) => {
      const before = foundInScope(
        await tx.customer.findFirst({
          where: inScope(customerScope(context), {
            id: customerId,
            deletedAt: null,
          }),
          select: detailFields,
        }),
        'customer',
      );

      const kept = new Set(before.references.map((reference) => reference.id));
      const unknown = input.references.findIndex(
        (reference) => reference.id !== undefined && !kept.has(reference.id),
      );
      if (unknown !== -1) {
        throw new DomainError(
          'UNKNOWN_REFERENCE',
          'A reference person no longer belongs to this customer. Reload and try again.',
          [
            {
              field: `references.${unknown}.id`,
              issue: 'is not this customer’s',
            },
          ],
        );
      }

      if (input.mobile !== before.mobile && !input.confirmDuplicateMobile) {
        await assertMobileUnshared(tx, context, input.mobile, before.id);
      }

      const listed = new Set(
        input.references.flatMap((reference) =>
          reference.id ? [reference.id] : [],
        ),
      );
      const referenceData = (reference: UpdateInput['references'][number]) => ({
        name: reference.name,
        mobile: reference.mobile,
        relation: reference.relation ?? null,
        address: reference.address ?? null,
      });

      const customer = await tx.customer.update({
        where: { id: before.id },
        data: {
          name: input.name,
          mobile: input.mobile,
          alternateMobile: input.alternateMobile ?? null,
          address: input.address,
          notes: input.notes ?? null,
          status: input.status,
          references: {
            deleteMany: { id: { notIn: [...listed] } },
            update: input.references.flatMap((reference) =>
              reference.id
                ? [
                    {
                      where: { id: reference.id },
                      data: referenceData(reference),
                    },
                  ]
                : [],
            ),
            create: input.references
              .filter((reference) => !reference.id)
              .map((reference) => ({
                ...referenceData(reference),
                createdByUserId: context.userId,
              })),
          },
        },
        select: detailFields,
      });

      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'customer',
        entityId: customer.id,
        before: auditedFields(before),
        after: {
          ...auditedFields(customer),
          duplicateMobileConfirmed:
            input.mobile !== before.mobile && input.confirmDuplicateMobile,
        },
      });
      return toDetail(customer);
    });
  }

  /**
   * US-023. The customer moves to the new line **from today**: today's route
   * is the new line's, and the sector follows the line. Past collections keep
   * the line they were taken under (BR-15) and are not touched.
   *
   * The move closes the open period today and opens the next one today too,
   * so on the transfer day both lines cover the date and a
   * collection taken at the door before the transfer can still be synced by
   * the Junior who took it — `collectableAccountScope` reads these rows.
   */
  transfer(
    context: RequestContext,
    customerId: string,
    input: TransferInput,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<CustomerDetail> {
    return this.database.transaction(async (tx) => {
      const before = foundInScope(
        await tx.customer.findFirst({
          where: inScope(customerScope(context), {
            id: customerId,
            deletedAt: null,
          }),
          select: { id: true, lineId: true, line: { select: { name: true } } },
        }),
        'customer',
      );
      const line = foundInScope(
        await tx.line.findFirst({
          where: inScope(lineScope(context), { id: input.lineId }),
          select: { id: true, name: true, sectorId: true, isActive: true },
        }),
        'line',
      );
      if (!line.isActive) {
        throw new DomainError(
          'LINE_INACTIVE',
          'A customer cannot be moved to an inactive line',
          [{ field: 'lineId', issue: 'is inactive' }],
        );
      }
      if (line.id === before.lineId) {
        throw new DomainError(
          'SAME_LINE',
          `${before.line.name} is the line they are already on.`,
          [{ field: 'lineId', issue: 'is the line they are already on' }],
        );
      }

      const from = toUtcMidnight(today);
      // The old period ends today rather than yesterday: while the day is in
      // flight both lines cover it, so a collection taken at the door this
      // morning still syncs from the old line's Junior (US-050).
      await tx.customerLinePeriod.updateMany({
        where: { customerId: before.id, effectiveTo: null },
        data: { effectiveTo: from },
      });
      await tx.customerLinePeriod.create({
        data: {
          customerId: before.id,
          lineId: line.id,
          effectiveFrom: from,
          reason: input.reason ?? null,
          createdByUserId: context.userId,
        },
      });

      const customer = await tx.customer.update({
        where: { id: before.id },
        data: { lineId: line.id, sectorId: line.sectorId },
        select: detailFields,
      });

      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'customer',
        entityId: customer.id,
        before: { lineId: before.lineId },
        after: {
          lineId: customer.lineId,
          effectiveFrom: fromUtcMidnight(from),
          reason: input.reason ?? null,
        },
      });
      return toDetail(customer);
    });
  }

  /** US-023: every line this customer has been on, newest first. */
  async transfers(
    context: RequestContext,
    customerId: string,
  ): Promise<{ data: CustomerLinePeriod[] }> {
    foundInScope(
      await this.database.client.customer.findFirst({
        where: inScope(customerScope(context), {
          id: customerId,
          deletedAt: null,
        }),
        select: { id: true },
      }),
      'customer',
    );
    const rows = await this.database.client.customerLinePeriod.findMany({
      where: { customerId },
      select: periodFields,
      orderBy: { effectiveFrom: 'desc' },
    });
    return { data: rows.map(toPeriod) };
  }
}

const periodFields = {
  id: true,
  lineId: true,
  effectiveFrom: true,
  effectiveTo: true,
  reason: true,
  line: { select: { name: true, code: true } },
} as const satisfies Prisma.CustomerLinePeriodSelect;

function toPeriod(
  row: Prisma.CustomerLinePeriodGetPayload<{ select: typeof periodFields }>,
): CustomerLinePeriod {
  return {
    id: row.id,
    lineId: row.lineId,
    lineName: row.line.name,
    lineCode: row.line.code,
    effectiveFrom: fromUtcMidnight(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? fromUtcMidnight(row.effectiveTo) : null,
    reason: row.reason,
  };
}

/**
 * US-024: what one search box matches — part of the name in any case, or
 * exactly a customer code or a mobile. A code may be typed whole (`cus-417`,
 * `CUS-00417`) or as its number; a mobile in any form onboarding accepts.
 * The name match is `ILIKE`; a trigram index would serve it unchanged (M04).
 */
export function searchTerms(q: string): Prisma.CustomerWhereInput[] {
  const terms: Prisma.CustomerWhereInput[] = [
    { name: { contains: q, mode: 'insensitive' } },
  ];
  const code = /^(?:cus-?)?(\d{1,9})$/i.exec(q);
  if (code) {
    terms.push({ customerCode: formatCustomerCode(Number(code[1])) });
  }
  const mobile = mobileSchema.safeParse(q);
  if (mobile.success) terms.push({ mobile: mobile.data });
  return terms;
}

/** What an edit can change, as the audit entry records it (US-021). */
function auditedFields(row: DetailRow) {
  return {
    name: row.name,
    mobile: row.mobile,
    alternateMobile: row.alternateMobile,
    address: row.address,
    notes: row.notes,
    status: row.status,
    references: row.references.map(({ id, name, mobile, relation }) => ({
      id,
      name,
      mobile,
      relation,
    })),
  };
}

/**
 * US-020 / US-021: a mobile already on another of the organization's
 * customers is `409 DUPLICATE_MOBILE` until confirmed — a warning, not a rule
 * (M04), so it is checked before any write and never enforced by the database.
 * Organization-wide, not scoped to the caller: a duplicate on another line is
 * still a duplicate.
 */
async function assertMobileUnshared(
  tx: Prisma.TransactionClient,
  context: RequestContext,
  mobile: string,
  exceptCustomerId?: string,
): Promise<void> {
  const sharing = await tx.customer.count({
    where: {
      organizationId: context.organizationId,
      deletedAt: null,
      mobile,
      ...(exceptCustomerId ? { id: { not: exceptCustomerId } } : {}),
    },
  });
  if (sharing > 0) {
    throw new ConflictError(
      'DUPLICATE_MOBILE',
      `${sharing === 1 ? 'Another customer has' : `${sharing} customers have`} this mobile number. Check it is not the same person, then confirm to continue.`,
      [{ field: 'mobile', issue: 'is already used by another customer' }],
    );
  }
}
