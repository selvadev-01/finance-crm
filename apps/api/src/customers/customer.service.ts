import { Injectable } from '@nestjs/common';
import type {
  CustomerDetail,
  CustomerSummary,
  RouteInput,
} from '@repo/contracts';
import { customerContract } from '@repo/contracts';
import type { Prisma } from '@repo/db';

import {
  customerScope,
  foundInScope,
  inScope,
  lineScope,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
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
  ) {}

  async list(
    context: RequestContext,
    page: PageRequest & {
      lineId?: string | undefined;
      mobile?: string | undefined;
      status?: CustomerSummary['status'] | undefined;
    },
  ): Promise<Page<CustomerSummary>> {
    const rows = await this.database.client.customer.findMany({
      where: inScope(customerScope(context), {
        deletedAt: null,
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
  create(context: RequestContext, input: CreateInput): Promise<CustomerDetail> {
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
        const sharing = await tx.customer.count({
          where: {
            organizationId: context.organizationId,
            deletedAt: null,
            mobile: input.mobile,
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
      return toDetail(customer);
    });
  }
}
