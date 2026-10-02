import type { CalendarDate } from '@repo/domain';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { CapitalService } from '../../src/cash/capital.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import type { Database } from '../../src/platform/database/database.js';

/**
 * The owner puts in what a loan is about to pay out (decided 2026-10-02: a
 * day-one disbursement is refused when office cash holds less than `I`).
 * Test worlds call it just before disbursing, so office cash after the
 * disbursement is what it was before — and each test's own figures stand.
 */
export async function fundOfficeCash(
  database: Database,
  owner: RequestContext,
  amount: string,
  on: CalendarDate,
): Promise<void> {
  await new CapitalService(
    database,
    new AuditWriter(database),
    new LedgerService(database),
  ).add(owner, { amount, note: 'Test: funds the next loan' }, on);
}
