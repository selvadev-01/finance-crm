import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type RouteEntry,
  RouteAccessAudit,
} from '../src/access/route-access.audit.js';
import { createTestApp } from './app.js';

/**
 * M13 audit coverage (decided 2026-09-15: services call `AuditWriter`
 * directly, held to it by this test rather than an event bus).
 *
 * **Every route that changes something must say whether it is audited**, and
 * what it records. A new write route fails here until someone decides —
 * deliberately, in review — which audit entry it writes, or why it writes
 * none. For each declared entry, the source must contain a writer that records
 * that table and action, so a declaration cannot outlive its code.
 *
 * What each writer actually commits is proven by the modules' Tier 1 specs,
 * against real rows; HTTP tests cannot keep audit rows.
 */
type Decision =
  | { audits: readonly [table: string, action: string][] }
  | { notAudited: string };

const WRITE_ROUTES: Record<string, Decision> = {
  // M03 organisation
  'POST /api/sectors': { audits: [['sector', 'CREATE']] },
  'PATCH /api/sectors/:sectorId': { audits: [['sector', 'UPDATE']] },
  'POST /api/sectors/:sectorId/deactivation': {
    audits: [['sector', 'UPDATE']],
  },
  'POST /api/lines': { audits: [['line', 'CREATE']] },
  'PATCH /api/lines/:lineId': { audits: [['line', 'UPDATE']] },
  'POST /api/lines/:lineId/deactivation': { audits: [['line', 'UPDATE']] },
  'POST /api/lines/:lineId/senior-assignment': {
    audits: [
      ['line_assignment', 'CREATE'],
      ['line_assignment', 'UPDATE'],
    ],
  },
  'POST /api/lines/:lineId/junior-assignment': {
    audits: [
      ['line_assignment', 'CREATE'],
      ['line_assignment', 'UPDATE'],
    ],
  },
  // M15 settings (US-094): an override row, or the organisation's own record.
  'PATCH /api/settings/:key': {
    audits: [
      ['setting', 'CREATE'],
      ['setting', 'UPDATE'],
      ['setting', 'DELETE'],
      ['organization', 'UPDATE'],
    ],
  },
  // M06 working calendar (US-093)
  'POST /api/holidays': { audits: [['holiday', 'CREATE']] },
  'DELETE /api/holidays/:holidayId': { audits: [['holiday', 'DELETE']] },
  // M01 identity
  'POST /api/organizations': {
    audits: [
      ['organization', 'CREATE'],
      ['staff_profile', 'CREATE'],
    ],
  },
  'POST /api/staff/:staffProfileId/password-reset': {
    audits: [['staff_profile', 'UPDATE']],
  },
  // M01 staff administration (US-092)
  'POST /api/staff': { audits: [['staff_profile', 'CREATE']] },
  'PATCH /api/staff/:staffProfileId': {
    audits: [['staff_profile', 'UPDATE']],
  },
  'POST /api/staff/:staffProfileId/role': {
    audits: [['staff_profile', 'UPDATE']],
  },
  'POST /api/staff/:staffProfileId/status': {
    audits: [['staff_profile', 'UPDATE']],
  },
  'DELETE /api/staff/:staffProfileId': {
    audits: [['staff_profile', 'DELETE']],
  },
  // M04, M05
  'POST /api/customers': { audits: [['customer', 'CREATE']] },
  'PATCH /api/customers/:customerId': { audits: [['customer', 'UPDATE']] },
  'POST /api/customers/:customerId/line-transfer': {
    audits: [['customer', 'UPDATE']],
  },
  'POST /api/accounts/preview': {
    notAudited: 'computes a schedule; writes nothing',
  },
  'POST /api/accounts': { audits: [['account_loan', 'CREATE']] },
  'POST /api/accounts/:accountId/disbursement': {
    audits: [['account_loan', 'UPDATE']],
  },
  'POST /api/accounts/:accountId/closure': {
    audits: [['account_loan', 'UPDATE']],
  },
  'PATCH /api/accounts/:accountId': { audits: [['account_loan', 'UPDATE']] },
  // M07
  'POST /api/collections': { audits: [['collection', 'CREATE']] },
  'POST /api/collections/:collectionId/corrections': {
    audits: [['collection', 'CREATE']],
  },
  'POST /api/collections/:collectionId/reversal': {
    audits: [['collection', 'CREATE']],
  },
  'POST /api/collection-approvals/:approvalId/decision': {
    audits: [
      ['collection', 'APPROVE'],
      ['collection', 'REJECT'],
    ],
  },
  'POST /api/devices/sync-report': {
    notAudited:
      "a phone's queue size, overwritten on every report; not business data",
  },
  // M08
  'POST /api/lines/:lineId/day-closes/:businessDate/close': {
    audits: [['day_close', 'UPDATE']],
  },
  'POST /api/lines/:lineId/day-closes/:businessDate/reopen': {
    audits: [['day_close', 'REOPEN_DAY']],
  },
  'POST /api/handovers': { audits: [['cash_handover', 'CREATE']] },
  'POST /api/handovers/:handoverId/acknowledge': {
    audits: [['cash_handover', 'APPROVE']],
  },
  'POST /api/handovers/:handoverId/dispute': {
    audits: [['cash_handover', 'REJECT']],
  },
  // M10 — the user's own inbox and devices, not business records (M13 "What is audited")
  'POST /api/notifications/:notificationId/read': {
    notAudited: "marks the caller's own notification read",
  },
  'POST /api/notifications/read-all': {
    notAudited: "marks the caller's own notifications read",
  },
  'POST /api/push-subscriptions': {
    notAudited: "registers the caller's own device for push",
  },
  'DELETE /api/push-subscriptions/:subscriptionId': {
    notAudited: 'stops push to a device; delivery only',
  },
  'PATCH /api/notification-preferences': {
    notAudited: "the caller's own notification categories",
  },
};

const catalogue = await createTestApp();
const writeRoutes: RouteEntry[] = catalogue
  .get(RouteAccessAudit)
  .routes()
  .filter((route) => route.method !== 'GET');
await catalogue.close();

/** The `{ … }` literal around `index`, by brace depth. */
function enclosingObject(source: string, index: number): string {
  let start = index;
  for (let depth = 0; start > 0; start -= 1) {
    const char = source[start - 1];
    if (char === '}') depth += 1;
    if (char === '{') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  let end = index;
  for (let depth = 0; end < source.length; end += 1) {
    const char = source[end];
    if (char === '{') depth += 1;
    if (char === '}') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return source.slice(start, end);
}

/** Every (table, action) pair some source file records, read from the code. */
function recordedPairs(): Set<string> {
  const root = join(import.meta.dirname, '../src');
  const pairs = new Set<string>();
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
    (file) =>
      file.endsWith('.ts') &&
      !file.endsWith('.spec.ts') &&
      !file.endsWith('.controller.ts'),
  );
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const match of source.matchAll(/entityTable: '([a-z_]+)'/g)) {
      // The action counts only from the `action:` property of the same entry
      // object literal (it may be a ternary there), never a neighbouring entry.
      const entry = enclosingObject(source, match.index);
      const property = /action:([^,}]*)/.exec(entry)?.[1] ?? '';
      for (const action of property.matchAll(
        /'(CREATE|UPDATE|DELETE|APPROVE|REJECT|LOGIN|REOPEN_DAY)'/g,
      )) {
        pairs.add(`${match[1]} ${action[1]}`);
      }
    }
  }
  return pairs;
}

describe('audit coverage (M13, US-090)', () => {
  it('every served write route has an audit decision, and no decision names a route that is gone', () => {
    const served = writeRoutes
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(served).toEqual(Object.keys(WRITE_ROUTES).sort());
  });

  it('every declared audit entry has a writer in the source that records that table and action', () => {
    const pairs = recordedPairs();
    const missing = Object.entries(WRITE_ROUTES).flatMap(([route, decision]) =>
      'audits' in decision
        ? decision.audits
            .filter(([table, action]) => !pairs.has(`${table} ${action}`))
            .map((pair) => `${route}: ${pair.join(' ')}`)
        : [],
    );
    expect(missing).toEqual([]);
  });

  it('a route marked not audited says why', () => {
    for (const decision of Object.values(WRITE_ROUTES)) {
      if ('notAudited' in decision)
        expect(decision.notAudited.trim().length).toBeGreaterThan(10);
    }
  });
});
