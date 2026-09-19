import type {
  CollectionListItem,
  LineWiseReport,
  OverdueAccount,
} from '@repo/contracts';

import { collectionListDocument } from '../../src/collections/collection-export.js';
import { lineDocument } from '../../src/dashboards/dashboard-exports.js';
import type {
  ExportDocument,
  ExportTable,
} from '../../src/exports/export-document.js';
import {
  lineWiseDocument,
  overdueDocument,
} from '../../src/reports/report-exports.js';

/**
 * The builders turn a view the service already returned into a document
 * (M12). Pure: these hold the columns to the view's figures, and a group the
 * view could not read to `null` — never `0` (S-07).
 */
const table = (document: ExportDocument, title: string) =>
  document.sections.find(
    (section): section is ExportTable =>
      section.kind === 'table' && section.title.startsWith(title),
  )!;

const cell = (t: ExportTable, row: readonly unknown[], header: string) =>
  row[t.columns.findIndex((column) => column.header === header)];

describe('line-wise export (US-084)', () => {
  const row = {
    lineId: 'l1',
    code: 'LN-01',
    name: 'Market',
    isActive: true,
    sectorId: 's1',
    sectorCode: 'SEC-01',
    sectorName: 'North',
    staff: { seniorName: 'Senior One', juniorNames: ['J One', 'J Two'] },
    book: {
      customers: 4,
      accounts: 5,
      activeAccounts: 3,
      completedAccounts: 2,
    },
    amounts: {
      accountAmount: '12000.00',
      invested: '10200.00',
      profit: '1800.00',
    },
    collections: {
      expected: '1500.00',
      collected: '1400.00',
      pending: '200.00',
      extra: '100.00',
    },
  } satisfies NonNullable<LineWiseReport['lines']>[number];

  const report: LineWiseReport = {
    from: '2026-09-01',
    to: '2026-09-19',
    generatedAt: '2026-09-19T08:30:00.000Z',
    lines: [
      row,
      { ...row, lineId: 'l2', code: 'LN-02', isActive: false, amounts: null },
    ],
    totals: {
      lines: 2,
      book: {
        customers: 8,
        accounts: 10,
        activeAccounts: 6,
        completedAccounts: 4,
      },
      amounts: null,
      collections: {
        expected: '3000.00',
        collected: '2800.00',
        pending: '400.00',
        extra: '200.00',
      },
    },
  };

  it('carries §14 column for column, with the totals row the report summed', () => {
    const document = lineWiseDocument(report, {});
    const lines = table(document, 'Lines');
    const first = lines.rows[0]!;
    expect(cell(lines, first, 'Line code')).toBe('LN-01');
    expect(cell(lines, first, 'Juniors')).toBe('J One, J Two');
    expect(cell(lines, first, 'Customers')).toBe(4);
    expect(cell(lines, first, 'Profit')).toBe('1800.00');
    expect(cell(lines, first, 'Pending')).toBe('200.00');
    expect(cell(lines, lines.totals!, 'Collected')).toBe('2800.00');
    expect(document.filename).toBe('rasi-line-wise-2026-09-01-to-2026-09-19');
  });

  it('writes an unreadable group as null on the row and in the totals, never 0 (S-07)', () => {
    const lines = table(lineWiseDocument(report, {}), 'Lines');
    const second = lines.rows[1]!;
    expect(cell(lines, second, 'Invested')).toBeNull();
    expect(cell(lines, second, 'Line')).toBe('Market (inactive)');
    expect(cell(lines, lines.totals!, 'Account amount')).toBeNull();
  });

  it('names a line filter from the rows, and still says so when nothing matched', () => {
    expect(lineWiseDocument(report, { lineId: 'l1' }).facts).toContainEqual([
      'Line',
      'LN-01 Market',
    ]);
    const empty = lineWiseDocument(
      { ...report, lines: [], totals: null },
      { lineId: 'gone' },
    );
    expect(empty.facts.find(([label]) => label === 'Line')?.[1]).toMatch(
      /no rows matched/,
    );
  });
});

describe('overdue export (US-087)', () => {
  const account = (arrears: OverdueAccount['arrears']): OverdueAccount => ({
    accountLoanId: 'a1',
    accountCode: 'AC-1',
    customerId: 'c1',
    customerName: 'Customer',
    lineId: 'l1',
    lineCode: 'LN-01',
    lineName: 'Market',
    sectorId: 's1',
    sectorName: 'North',
    dailyAmount: '100.00',
    accountAmount: '1200.00',
    outstanding: '300.00',
    targetCompletionDate: '2026-09-10',
    daysOverdue: 9,
    arrears,
  });

  const report = {
    asOf: '2026-09-19',
    generatedAt: '2026-09-19T08:30:00.000Z',
    summary: null,
  };

  it('tells "never visited" (blank) apart from "could not be read" (null)', () => {
    const t = table(
      overdueDocument(
        report,
        [
          account({ amount: '300.00', unpaidDays: 3, lastCollection: null }),
          account(null),
        ],
        { sort: 'daysOverdue' },
      ),
      'Overdue accounts',
    );
    const [neverVisited, unreadable] = t.rows;
    expect(cell(t, neverVisited!, 'Last visit')).toBe('');
    expect(cell(t, neverVisited!, 'Last amount')).toBe('');
    expect(cell(t, unreadable!, 'Last visit')).toBeNull();
    expect(cell(t, unreadable!, 'Arrears')).toBeNull();
  });

  it('writes an unreadable summary as null figures', () => {
    const document = overdueDocument(report, [], { sort: 'outstanding' });
    const summary = document.sections[0]!;
    expect(
      summary.kind === 'figures' &&
        summary.figures.every((f) => f.value === null),
    ).toBe(true);
    expect(document.facts).toContainEqual(['Sorted by', 'Outstanding']);
  });
});

describe('collection list export (S-16)', () => {
  const entry = (
    overrides: Partial<CollectionListItem>,
  ): CollectionListItem => ({
    id: 'c1',
    entryType: 'ORIGINAL',
    status: 'CONFIRMED',
    adjustsCollectionId: null,
    accountLoanId: 'a1',
    accountCode: 'AC-1',
    customerId: 'cu1',
    customerName: 'Customer',
    lineId: 'l1',
    lineName: 'Market',
    collectedByUserId: 'u1',
    collectedByName: 'J One',
    businessDate: '2026-09-18',
    capturedAt: '2026-09-18T04:30:00.000Z',
    syncedAt: '2026-09-18T04:31:00.000Z',
    expectedAmount: '100.00',
    amount: '80.00',
    variance: '-20.00',
    classification: 'LOW',
    note: null,
    ...overrides,
  });

  it('keeps a correction as its own row, with no expectation of its own', () => {
    const t = table(
      collectionListDocument(
        [
          entry({}),
          entry({
            id: 'c2',
            entryType: 'ADJUSTMENT',
            adjustsCollectionId: 'c1',
            expectedAmount: '0.00',
            amount: '20.00',
            variance: '20.00',
            classification: 'CORRECT',
          }),
        ],
        { from: '2026-09-01', to: '2026-09-19' },
        new Date('2026-09-19T08:30:00.000Z'),
      ),
      'Collections',
    );
    expect(t.rows).toHaveLength(2);
    expect(cell(t, t.rows[0]!, 'Entry')).toBe('Visit');
    expect(cell(t, t.rows[0]!, 'Expected')).toBe('100.00');
    expect(cell(t, t.rows[1]!, 'Entry')).toBe('Correction');
    expect(cell(t, t.rows[1]!, 'Expected')).toBe('');
    expect(cell(t, t.rows[1]!, 'Amount')).toBe('20.00');
  });
});

describe('line dashboard export (US-083)', () => {
  it('says plainly that a Senior with no line has nothing to export', () => {
    const document = lineDocument({
      state: 'NO_LINE',
      businessDate: '2026-09-19',
      generatedAt: '2026-09-19T08:30:00.000Z',
    });
    expect(document.sections).toEqual([]);
    expect(document.facts).toContainEqual([
      'Line',
      'No line is assigned to you on this date.',
    ]);
  });
});
