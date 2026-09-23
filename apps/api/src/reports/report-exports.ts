import type {
  CollectionReport,
  DiscrepancyReport,
  DiscrepancyRow,
  InvestmentReport,
  LineWiseReport,
  OverdueAccount,
  OverdueReport,
} from '@repo/contracts';

import type {
  ExportColumn,
  ExportDocument,
} from '../exports/export-document.js';
import {
  AMOUNTS_FACT,
  type Fact,
  filterFact,
  generatedFact,
  humanize,
  known,
  periodFact,
  rangeStem,
} from '../exports/export-facts.js';

/**
 * The M12 reports as export documents: the report the screen shows, column
 * for column, with its totals row. Pure — each takes the report the service
 * already returned, so the file and the page are one read.
 */

interface LineFilters {
  sectorId?: string;
  lineId?: string;
}

/** Sector and line filters, named from the rows (every row carries both). */
function lineFilterFacts(
  filters: LineFilters,
  rows:
    | readonly {
        sectorName: string;
        code?: string;
        lineCode?: string;
        name?: string;
        lineName?: string;
      }[]
    | null,
): Fact[] {
  const first = rows?.[0];
  const lineName = first
    ? `${first.code ?? first.lineCode ?? ''} ${first.name ?? first.lineName ?? ''}`.trim()
    : undefined;
  return [
    ...filterFact('Sector', filters.sectorId, first?.sectorName),
    ...filterFact('Line', filters.lineId, lineName),
  ];
}

const LINE_COLUMNS: ExportColumn[] = [
  { header: 'Line code', kind: 'text' },
  { header: 'Line', kind: 'text' },
  { header: 'Sector', kind: 'text' },
];

function lineCells(row: {
  code: string;
  name: string;
  isActive: boolean;
  sectorName: string;
}): string[] {
  return [
    row.code,
    row.isActive ? row.name : `${row.name} (inactive)`,
    row.sectorName,
  ];
}

/** US-084, PDF §14. */
export function lineWiseDocument(
  report: LineWiseReport,
  filters: LineFilters,
): ExportDocument {
  const columns: ExportColumn[] = [
    ...LINE_COLUMNS,
    { header: 'Senior', kind: 'text' },
    { header: 'Juniors', kind: 'text' },
    { header: 'Customers', kind: 'count' },
    { header: 'Accounts', kind: 'count' },
    { header: 'Active', kind: 'count' },
    { header: 'Completed', kind: 'count' },
    { header: 'Account amount', kind: 'money' },
    { header: 'Invested', kind: 'money' },
    { header: 'Profit', kind: 'money' },
    { header: 'Expected', kind: 'money' },
    { header: 'Collected', kind: 'money' },
    { header: 'Pending', kind: 'money' },
    { header: 'Extra', kind: 'money' },
  ];
  type Totals = NonNullable<LineWiseReport['totals']>;
  const figures = (group: Pick<Totals, 'book' | 'amounts' | 'collections'>) => [
    known(group.book, (book) => book.customers),
    known(group.book, (book) => book.accounts),
    known(group.book, (book) => book.activeAccounts),
    known(group.book, (book) => book.completedAccounts),
    known(group.amounts, (amounts) => amounts.accountAmount),
    known(group.amounts, (amounts) => amounts.invested),
    known(group.amounts, (amounts) => amounts.profit),
    known(group.collections, (collections) => collections.expected),
    known(group.collections, (collections) => collections.collected),
    known(group.collections, (collections) => collections.pending),
    known(group.collections, (collections) => collections.extra),
  ];
  const rows = report.lines ?? [];
  return {
    title: 'Line-wise report',
    filename: rangeStem('line-wise', report.from, report.to),
    facts: [
      periodFact(report.from, report.to),
      ...lineFilterFacts(filters, report.lines),
      AMOUNTS_FACT,
      generatedFact(report.generatedAt),
    ],
    sections: [
      {
        kind: 'table',
        title: 'Lines',
        columns,
        rows: rows.map((row) => [
          ...lineCells(row),
          row.staff.seniorName ?? '',
          row.staff.juniorNames.join(', '),
          ...figures(row),
        ]),
        totals: report.totals
          ? [
              'Total',
              `${report.totals.lines} lines`,
              '',
              '',
              '',
              ...figures(report.totals),
            ]
          : undefined,
        empty:
          report.lines === null
            ? 'The lines could not be read when this file was made.'
            : 'No line matches these filters.',
      },
    ],
  };
}

/** US-085, PDF §22 — the standing position, and the period's own movement. */
export function investmentDocument(
  report: InvestmentReport,
  filters: LineFilters,
): ExportDocument {
  type Position = NonNullable<InvestmentReport['totals']>['position'];
  type Movement = NonNullable<InvestmentReport['totals']>['range'];
  const position = (group: Position) => [
    known(group, (p) => p.accounts),
    known(group, (p) => p.accountAmount),
    known(group, (p) => p.invested),
    known(group, (p) => p.profit),
    known(group, (p) => p.outstanding),
    known(group, (p) => p.returned),
    known(group, (p) => p.profitEarned),
    known(group, (p) => p.profitToEarn),
  ];
  const movement = (group: Movement) => [
    known(group, (m) => m.disbursements),
    known(group, (m) => m.accountAmount),
    known(group, (m) => m.invested),
    known(group, (m) => m.profit),
    known(group, (m) => m.returned),
    known(group, (m) => m.profitEarned),
  ];
  const rows = report.lines ?? [];
  const empty =
    report.lines === null
      ? 'The lines could not be read when this file was made.'
      : 'No line matches these filters.';
  const totalLabel = report.totals
    ? ['Total', `${report.totals.lines} lines`, '']
    : [];
  return {
    title: 'Investment overview',
    filename: rangeStem('investment', report.from, report.to),
    facts: [
      periodFact(report.from, report.to),
      ...lineFilterFacts(filters, report.lines),
      [
        'Position',
        'Contracted and actual figures are as of now; only the period table is bounded by the dates.',
      ],
      AMOUNTS_FACT,
      generatedFact(report.generatedAt),
    ],
    sections: [
      {
        kind: 'table',
        title: 'Position now',
        columns: [
          ...LINE_COLUMNS,
          { header: 'Accounts', kind: 'count' },
          { header: 'Account amount', kind: 'money' },
          { header: 'Invested', kind: 'money' },
          { header: 'Profit', kind: 'money' },
          { header: 'Outstanding', kind: 'money' },
          { header: 'Returned', kind: 'money' },
          { header: 'Profit earned', kind: 'money' },
          { header: 'Profit to earn', kind: 'money' },
        ],
        rows: rows.map((row) => [...lineCells(row), ...position(row.position)]),
        totals: report.totals
          ? [...totalLabel, ...position(report.totals.position)]
          : undefined,
        empty,
      },
      {
        kind: 'table',
        title: 'In the period',
        columns: [
          ...LINE_COLUMNS,
          { header: 'Disbursed', kind: 'count' },
          { header: 'Account amount', kind: 'money' },
          { header: 'Invested', kind: 'money' },
          { header: 'Profit', kind: 'money' },
          { header: 'Returned', kind: 'money' },
          { header: 'Profit earned', kind: 'money' },
        ],
        rows: rows.map((row) => [...lineCells(row), ...movement(row.range)]),
        totals: report.totals
          ? [...totalLabel, ...movement(report.totals.range)]
          : undefined,
        empty,
      },
    ],
  };
}

interface CollectionFilters extends LineFilters {
  collectedByUserId?: string;
  classification?: string;
}

/** US-086 — expected against collected, then BR-08's breakdown. */
export function collectionReportDocument(
  report: CollectionReport,
  filters: CollectionFilters,
): ExportDocument {
  type Comparison = NonNullable<CollectionReport['totals']>['collections'];
  type Breakdown = NonNullable<CollectionReport['totals']>['classification'];
  const comparison = (group: Comparison) => [
    known(group, (c) => c.expected),
    known(group, (c) => c.collected),
    known(group, (c) => c.variance),
    known(group, (c) => c.pending),
    known(group, (c) => c.extra),
    known(group, (c) => c.missed),
  ];
  const breakdown = (group: Breakdown) => [
    known(group, (b) => b.recorded),
    known(group, (b) => b.amount),
    known(group, (b) => b.correct.count),
    known(group, (b) => b.correct.amount),
    known(group, (b) => b.low.count),
    known(group, (b) => b.low.amount),
    known(group, (b) => b.extra.count),
    known(group, (b) => b.extra.amount),
    known(group, (b) => b.noPayment.count),
    known(group, (b) => b.adjusted.count),
    known(group, (b) => b.adjusted.amount),
  ];
  const rows = report.lines ?? [];
  const empty =
    report.lines === null
      ? 'The lines could not be read when this file was made.'
      : 'No line matches these filters.';
  const totalLabel = report.totals
    ? ['Total', `${report.totals.lines} lines`, '']
    : [];
  return {
    title: 'Collection report',
    filename: rangeStem('collection-report', report.from, report.to),
    facts: [
      periodFact(report.from, report.to),
      ...lineFilterFacts(filters, report.lines),
      ...(filters.collectedByUserId
        ? [['Collected by', 'One collector only'] as const]
        : []),
      ...(filters.classification
        ? [['Class', humanize(filters.classification)] as const]
        : []),
      AMOUNTS_FACT,
      generatedFact(report.generatedAt),
    ],
    sections: [
      {
        kind: 'table',
        title: 'Expected against collected',
        columns: [
          ...LINE_COLUMNS,
          { header: 'Expected', kind: 'money' },
          { header: 'Collected', kind: 'money' },
          { header: 'Variance', kind: 'money' },
          { header: 'Pending', kind: 'money' },
          { header: 'Extra', kind: 'money' },
          { header: 'Missed visits', kind: 'count' },
        ],
        rows: rows.map((row) => [
          ...lineCells(row),
          ...comparison(row.collections),
        ]),
        totals: report.totals
          ? [...totalLabel, ...comparison(report.totals.collections)]
          : undefined,
        empty,
      },
      {
        kind: 'table',
        title: 'Classification',
        columns: [
          ...LINE_COLUMNS,
          { header: 'Visits', kind: 'count' },
          { header: 'Visit amount', kind: 'money' },
          { header: 'Correct', kind: 'count' },
          { header: 'Correct amount', kind: 'money' },
          { header: 'Low', kind: 'count' },
          { header: 'Low amount', kind: 'money' },
          { header: 'Extra', kind: 'count' },
          { header: 'Extra amount', kind: 'money' },
          { header: 'No payment', kind: 'count' },
          { header: 'Corrections', kind: 'count' },
          { header: 'Corrected by', kind: 'money' },
        ],
        rows: rows.map((row) => [
          ...lineCells(row),
          ...breakdown(row.classification),
        ]),
        totals: report.totals
          ? [...totalLabel, ...breakdown(report.totals.classification)]
          : undefined,
        empty,
      },
    ],
  };
}

interface OverdueFilters extends LineFilters {
  minDaysOverdue?: number;
  sort: string;
}

/** US-087 — every overdue account, not one page; the summary covers the set. */
export function overdueDocument(
  report: Omit<OverdueReport, 'data' | 'nextCursor' | 'hasMore' | 'total'>,
  rows: readonly OverdueAccount[],
  filters: OverdueFilters,
): ExportDocument {
  const summary = report.summary;
  return {
    title: 'Overdue report',
    filename: `rasi-overdue-${report.asOf}`,
    facts: [
      ['As of', report.asOf],
      ...lineFilterFacts(filters, rows),
      ...(filters.minDaysOverdue
        ? [['Overdue by', `At least ${filters.minDaysOverdue} days`] as const]
        : []),
      [
        'Sorted by',
        filters.sort === 'outstanding' ? 'Outstanding' : 'Days overdue',
      ],
      AMOUNTS_FACT,
      generatedFact(report.generatedAt),
    ],
    sections: [
      {
        kind: 'figures',
        title: 'Summary',
        figures: [
          {
            label: 'Accounts overdue',
            kind: 'count',
            value: known(summary, (s) => s.accounts),
          },
          {
            label: 'Lines',
            kind: 'count',
            value: known(summary, (s) => s.lines),
          },
          {
            label: 'Outstanding',
            kind: 'money',
            value: known(summary, (s) => s.outstanding),
          },
          {
            label: 'Arrears',
            kind: 'money',
            value: known(summary, (s) => s.arrears),
          },
          {
            label: 'Longest overdue',
            kind: 'text',
            value: known(summary, (s) =>
              s.longestOverdue
                ? `${s.longestOverdue.accountCode} ${s.longestOverdue.customerName}, ${s.longestOverdue.daysOverdue} days`
                : 'None',
            ),
          },
        ],
      },
      {
        kind: 'table',
        title: 'Overdue accounts',
        columns: [
          { header: 'Account', kind: 'text' },
          { header: 'Customer', kind: 'text' },
          { header: 'Line', kind: 'text' },
          { header: 'Sector', kind: 'text' },
          { header: 'Daily amount', kind: 'money' },
          { header: 'Account amount', kind: 'money' },
          { header: 'Outstanding', kind: 'money' },
          { header: 'Target date', kind: 'date' },
          { header: 'Days overdue', kind: 'count' },
          { header: 'Arrears', kind: 'money' },
          { header: 'Days short', kind: 'count' },
          { header: 'Last visit', kind: 'date' },
          { header: 'Last amount', kind: 'money' },
        ],
        rows: rows.map((row) => [
          row.accountCode,
          row.customerName,
          `${row.lineCode} ${row.lineName}`,
          row.sectorName,
          row.dailyAmount,
          row.accountAmount,
          row.outstanding,
          row.targetCompletionDate,
          row.daysOverdue,
          known(row.arrears, (a) => a.amount),
          known(row.arrears, (a) => a.unpaidDays),
          // No visit ever is a fact, not an unknown: an empty cell, not a dash.
          row.arrears ? (row.arrears.lastCollection?.businessDate ?? '') : null,
          row.arrears ? (row.arrears.lastCollection?.amount ?? '') : null,
        ]),
        empty: 'No account is overdue under these filters.',
      },
    ],
  };
}

interface DiscrepancyFilters extends LineFilters {
  collectedByUserId?: string;
  show: string;
}

/** BR-17 — every matching line, day and Junior; the summary covers the set. */
export function discrepancyDocument(
  report: Omit<DiscrepancyReport, 'data' | 'nextCursor' | 'hasMore' | 'total'>,
  rows: readonly DiscrepancyRow[],
  filters: DiscrepancyFilters,
): ExportDocument {
  const { summary } = report;
  return {
    title: 'Discrepancy report',
    filename: rangeStem('discrepancy', report.from, report.to),
    facts: [
      periodFact(report.from, report.to),
      ...lineFilterFacts(filters, rows),
      ...filterFact(
        'Junior',
        filters.collectedByUserId,
        rows[0]?.collectedByName,
      ),
      [
        'Showing',
        filters.show === 'all' ? 'Every row' : 'Only rows not yet tallied',
      ],
      [
        'Difference',
        'Handed over less collected: negative is short, positive is over.',
      ],
      AMOUNTS_FACT,
      generatedFact(report.generatedAt),
    ],
    sections: [
      {
        kind: 'figures',
        title: 'Summary',
        figures: [
          { label: 'Rows', kind: 'count', value: summary.rows },
          { label: 'Lines', kind: 'count', value: summary.lines },
          { label: 'Days', kind: 'count', value: summary.days },
          { label: 'Collected', kind: 'money', value: summary.collected },
          {
            label: 'Handed over',
            kind: 'money',
            value: known(summary.cash, (c) => c.handedOver),
          },
          {
            label: 'Acknowledged',
            kind: 'money',
            value: known(summary.cash, (c) => c.acknowledged),
          },
          {
            label: 'Awaiting acknowledgement',
            kind: 'money',
            value: known(summary.cash, (c) => c.awaiting),
          },
          {
            label: 'Short',
            kind: 'money',
            value: known(summary.cash, (c) => c.short),
          },
          {
            label: 'Over',
            kind: 'money',
            value: known(summary.cash, (c) => c.over),
          },
          {
            label: 'Net difference',
            kind: 'money',
            value: known(summary.cash, (c) => c.net),
          },
          {
            label: 'Not yet tallied',
            kind: 'count',
            value: known(summary.cash, (c) => c.unresolved),
          },
        ],
      },
      {
        kind: 'table',
        title: 'Discrepancies',
        columns: [
          { header: 'Date', kind: 'date' },
          { header: 'Line', kind: 'text' },
          { header: 'Sector', kind: 'text' },
          { header: 'Junior', kind: 'text' },
          { header: 'Collected', kind: 'money' },
          { header: 'Handed over', kind: 'money' },
          { header: 'Acknowledged', kind: 'money' },
          { header: 'Awaiting', kind: 'money' },
          { header: 'Difference', kind: 'money' },
          { header: 'State', kind: 'text' },
          { header: 'Day', kind: 'text' },
        ],
        rows: rows.map((row) => [
          row.businessDate,
          `${row.lineCode} ${row.lineName}`,
          row.sectorName,
          row.collectedByName,
          row.collected,
          known(row.cash, (c) => c.handedOver),
          known(row.cash, (c) => c.acknowledged),
          known(row.cash, (c) => c.awaiting),
          known(row.cash, (c) => c.difference),
          known(row.cash, (c) => humanize(c.state)),
          known(row.dayCloseStatus, humanize),
        ]),
        empty: 'No discrepancy matches these filters.',
      },
    ],
  };
}
