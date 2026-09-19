import type {
  AttentionItem,
  BusinessOverview,
  LineDashboard,
  OperationsDashboard,
  SectorComparison,
} from '@repo/contracts';

import type {
  ExportColumn,
  ExportDocument,
  ExportFigure,
  ExportSection,
} from '../exports/export-document.js';
import {
  AMOUNTS_FACT,
  dayLabel,
  generatedFact,
  humanize,
  known,
} from '../exports/export-facts.js';

/**
 * The M11 dashboards as export documents: the figures the screen shows for
 * one business date, then its tables. Pure — each takes the dashboard the
 * service already returned. A group the dashboard could not read is `null`
 * in every figure it feeds (S-07).
 */

function dayFacts(businessDate: string, day: Parameters<typeof dayLabel>[0]) {
  return [
    ['Business date', businessDate] as const,
    ['Day', dayLabel(day)] as const,
  ];
}

const money = (label: string, value: string | null): ExportFigure => ({
  label,
  kind: 'money',
  value,
});
const count = (label: string, value: number | null): ExportFigure => ({
  label,
  kind: 'count',
  value,
});

/** US-080, S-07 — §17's figures and §19's sector tally. */
export function overviewDocument(overview: BusinessOverview): ExportDocument {
  const { today, structure, accounts, totals, tally } = overview;
  return {
    title: 'Business overview',
    filename: `rasi-business-overview-${overview.businessDate}`,
    facts: [
      ...dayFacts(overview.businessDate, overview.day),
      AMOUNTS_FACT,
      generatedFact(overview.generatedAt),
    ],
    sections: [
      {
        kind: 'figures',
        title: 'Today',
        figures: [
          money(
            'Expected',
            known(today, (t) => t.expected),
          ),
          money(
            'Collected',
            known(today, (t) => t.collected),
          ),
          money(
            'Pending',
            known(today, (t) => t.pending),
          ),
          money(
            'Extra',
            known(today, (t) => t.extra),
          ),
          count(
            'Low entries',
            known(today, (t) => t.lowCount),
          ),
          count(
            'Extra entries',
            known(today, (t) => t.extraCount),
          ),
        ],
      },
      {
        kind: 'figures',
        title: 'Sectors today',
        figures: [
          count(
            'Sectors collecting',
            known(tally, (t) => t.collecting),
          ),
          count(
            'Tallied',
            known(tally, (t) => t.tallied),
          ),
          count(
            'With extra',
            known(tally, (t) => t.withExtra),
          ),
          count(
            'With low',
            known(tally, (t) => t.withLow),
          ),
        ],
      },
      {
        kind: 'figures',
        title: 'The business now',
        figures: [
          count(
            'Active sectors',
            known(structure, (s) => s.sectors),
          ),
          count(
            'Active lines',
            known(structure, (s) => s.lines),
          ),
          count(
            'Customers',
            known(structure, (s) => s.customers),
          ),
          count(
            'Active accounts',
            known(accounts, (a) => a.active),
          ),
          count(
            'Completed accounts',
            known(accounts, (a) => a.completed),
          ),
          money(
            'Account amount, all time',
            known(totals, (t) => t.accountAmount),
          ),
          money(
            'Invested, all time',
            known(totals, (t) => t.invested),
          ),
          money(
            'Profit, all time',
            known(totals, (t) => t.profit),
          ),
        ],
      },
      {
        kind: 'table',
        title: 'Sectors',
        columns: SECTOR_DAY_COLUMNS,
        rows: (overview.sectors ?? []).map((sector) => [
          sector.code,
          sector.name,
          sector.lineCount,
          ...sectorDayCells(sector),
        ]),
        empty:
          overview.sectors === null
            ? 'The sectors could not be read when this file was made.'
            : 'No sector has lines yet.',
      },
    ],
  };
}

const SECTOR_DAY_COLUMNS: ExportColumn[] = [
  { header: 'Code', kind: 'text' },
  { header: 'Sector', kind: 'text' },
  { header: 'Lines', kind: 'count' },
  { header: 'Expected', kind: 'money' },
  { header: 'Collected', kind: 'money' },
  { header: 'Shortfall', kind: 'money' },
  { header: 'Surplus', kind: 'money' },
  { header: 'Low', kind: 'count' },
  { header: 'Extra', kind: 'count' },
  { header: 'To close', kind: 'count' },
  { header: 'Closed', kind: 'count' },
  { header: 'Tallied', kind: 'count' },
  { header: 'Status', kind: 'text' },
];

function sectorDayCells(day: {
  expected: string;
  collected: string;
  shortfall: string;
  surplus: string;
  lowCount: number;
  extraCount: number;
  linesToClose: number;
  linesClosed: number;
  linesTallied: number;
  tally: string;
}) {
  return [
    day.expected,
    day.collected,
    day.shortfall,
    day.surplus,
    day.lowCount,
    day.extraCount,
    day.linesToClose,
    day.linesClosed,
    day.linesTallied,
    humanize(day.tally),
  ];
}

/** US-081 — every sector side by side, the business as the totals row. */
export function sectorsDocument(comparison: SectorComparison): ExportDocument {
  const columns: ExportColumn[] = [
    { header: 'Code', kind: 'text' },
    { header: 'Sector', kind: 'text' },
    { header: 'Lines', kind: 'count' },
    { header: 'Customers', kind: 'count' },
    { header: 'Account amount', kind: 'money' },
    { header: 'Invested', kind: 'money' },
    { header: 'Profit', kind: 'money' },
    ...SECTOR_DAY_COLUMNS.slice(3),
  ];
  const { business, tally } = comparison;
  const businessDay = business.today;
  return {
    title: 'Sector comparison',
    filename: `rasi-sector-comparison-${comparison.businessDate}`,
    facts: [
      ...dayFacts(comparison.businessDate, comparison.day),
      [
        'Amounts to date',
        'Account amount, invested and profit are all time, from disbursements.',
      ],
      AMOUNTS_FACT,
      generatedFact(comparison.generatedAt),
    ],
    sections: [
      {
        kind: 'figures',
        title: 'Sectors today',
        figures: [
          count(
            'Sectors collecting',
            known(tally, (t) => t.collecting),
          ),
          count(
            'Tallied',
            known(tally, (t) => t.tallied),
          ),
          count(
            'With extra',
            known(tally, (t) => t.withExtra),
          ),
          count(
            'With low',
            known(tally, (t) => t.withLow),
          ),
        ],
      },
      {
        kind: 'table',
        title: 'Sectors',
        columns,
        rows: (comparison.sectors ?? []).map((sector) => [
          sector.code,
          sector.isActive ? sector.name : `${sector.name} (inactive)`,
          known(sector.structure, (s) => s.lines),
          known(sector.structure, (s) => s.customers),
          known(sector.totals, (t) => t.accountAmount),
          known(sector.totals, (t) => t.invested),
          known(sector.totals, (t) => t.profit),
          ...(sector.today
            ? sectorDayCells(sector.today)
            : Array<null>(SECTOR_DAY_COLUMNS.length - 3).fill(null)),
        ]),
        totals: [
          'Business',
          known(business.structure, (s) => `${s.sectors} sectors`) ?? '',
          known(business.structure, (s) => s.lines),
          known(business.structure, (s) => s.customers),
          known(business.totals, (t) => t.accountAmount),
          known(business.totals, (t) => t.invested),
          known(business.totals, (t) => t.profit),
          known(businessDay, (d) => d.expected),
          known(businessDay, (d) => d.collected),
          known(businessDay, (d) => d.shortfall),
          known(businessDay, (d) => d.surplus),
          known(businessDay, (d) => d.lowCount),
          known(businessDay, (d) => d.extraCount),
          known(businessDay, (d) => d.linesToClose),
          known(businessDay, (d) => d.linesClosed),
          known(businessDay, (d) => d.linesTallied),
          '',
        ],
        empty:
          comparison.sectors === null
            ? 'The sectors could not be read when this file was made.'
            : 'No sector yet.',
      },
    ],
  };
}

/** US-082, S-20 — the day's money, then sectors, lines and what needs attention. */
export function operationsDocument(
  dashboard: OperationsDashboard,
): ExportDocument {
  const { today, pendingApprovals, customers, accounts, investment } =
    dashboard;
  return {
    title: 'Operations dashboard',
    filename: `rasi-operations-${dashboard.businessDate}`,
    facts: [
      ...dayFacts(dashboard.businessDate, dashboard.day),
      AMOUNTS_FACT,
      generatedFact(dashboard.generatedAt),
    ],
    sections: [
      {
        kind: 'figures',
        title: 'Today',
        figures: [
          money(
            'Expected',
            known(today, (t) => t.expected),
          ),
          money(
            'Collected',
            known(today, (t) => t.collected),
          ),
          money(
            'Pending',
            known(today, (t) => t.pending),
          ),
          money(
            'Extra',
            known(today, (t) => t.extra),
          ),
          count(
            'Low entries',
            known(today, (t) => t.lowCount),
          ),
          count(
            'Extra entries',
            known(today, (t) => t.extraCount),
          ),
          count(
            'Lines to close',
            known(today, (t) => t.linesToClose),
          ),
          count(
            'Lines not closed',
            known(today, (t) => t.linesNotClosed),
          ),
          count(
            'Corrections waiting',
            known(pendingApprovals, (p) => p.total),
          ),
          count(
            'Waiting for you',
            known(pendingApprovals, (p) => p.awaitingYou),
          ),
        ],
      },
      {
        kind: 'figures',
        title: 'The business now',
        figures: [
          count(
            'New customers today',
            known(customers, (c) => c.new),
          ),
          count(
            'Active customers',
            known(customers, (c) => c.active),
          ),
          count(
            'Accounts',
            known(accounts, (a) => a.total),
          ),
          count(
            'Active accounts',
            known(accounts, (a) => a.active),
          ),
          count(
            'Completed accounts',
            known(accounts, (a) => a.completed),
          ),
          money(
            'Invested, all time',
            known(investment, (i) => i.invested),
          ),
          money(
            'Profit, all time',
            known(investment, (i) => i.profit),
          ),
        ],
      },
      {
        kind: 'table',
        title: 'Sectors',
        columns: [
          { header: 'Code', kind: 'text' },
          { header: 'Sector', kind: 'text' },
          { header: 'Lines', kind: 'count' },
          { header: 'Active accounts', kind: 'count' },
          { header: 'Expected', kind: 'money' },
          { header: 'Collected', kind: 'money' },
        ],
        rows: (dashboard.sectors ?? []).map((sector) => [
          sector.code,
          sector.name,
          sector.lineCount,
          sector.activeAccounts,
          sector.expected,
          sector.collected,
        ]),
        empty:
          dashboard.sectors === null
            ? 'The sectors could not be read when this file was made.'
            : 'No sector yet.',
      },
      {
        kind: 'table',
        title: 'Lines',
        columns: [
          { header: 'Line code', kind: 'text' },
          { header: 'Line', kind: 'text' },
          { header: 'Sector', kind: 'text' },
          { header: 'Day', kind: 'text' },
          { header: 'Status', kind: 'text' },
          { header: 'Expected', kind: 'money' },
          { header: 'Collected', kind: 'money' },
          { header: 'Missed', kind: 'count' },
          { header: 'Low', kind: 'count' },
          { header: 'Extra', kind: 'count' },
          { header: 'Senior', kind: 'text' },
          { header: 'Juniors', kind: 'count' },
          { header: 'Active accounts', kind: 'count' },
        ],
        rows: (dashboard.lines ?? []).map((line) => [
          line.code,
          line.isActive ? line.name : `${line.name} (inactive)`,
          line.sectorName,
          dayLabel(line.day),
          humanize(line.status),
          line.expected,
          line.collected,
          line.missedCount,
          line.lowCount,
          line.extraCount,
          line.seniorName ?? '',
          line.juniorCount,
          line.activeAccounts,
        ]),
        empty:
          dashboard.lines === null
            ? 'The lines could not be read when this file was made.'
            : 'No line yet.',
      },
      attentionTable(dashboard.attention),
    ],
  };
}

function attentionTable(items: AttentionItem[] | null): ExportSection {
  return {
    kind: 'table',
    title: 'Needs attention',
    columns: [
      { header: 'What', kind: 'text' },
      { header: 'Line', kind: 'text' },
      { header: 'Detail', kind: 'text' },
      { header: 'Amount', kind: 'money' },
    ],
    rows: (items ?? []).map((item) => {
      switch (item.kind) {
        case 'DISPUTED_HANDOVER':
          return [
            'Disputed handover',
            `${item.lineCode} ${item.lineName}`,
            `${item.businessDate}, from ${item.fromName}`,
            item.discrepancy,
          ];
        case 'MISSED':
          return [
            'Missed visits',
            `${item.lineCode} ${item.lineName}`,
            `${item.count} missed`,
            '',
          ];
        case 'DAY_NOT_CLOSED':
          return [
            'Day not closed',
            `${item.lineCode} ${item.lineName}`,
            humanize(item.status),
            '',
          ];
        case 'PENDING_APPROVALS':
          return [
            'Corrections waiting',
            '',
            `${item.count} waiting, ${item.awaitingYou} for you`,
            '',
          ];
        case 'NO_SENIOR':
          return ['No Senior', `${item.lineCode} ${item.lineName}`, '', ''];
        case 'NO_JUNIOR':
          return ['No Junior', `${item.lineCode} ${item.lineName}`, '', ''];
      }
    }),
    empty:
      items === null
        ? 'What needs attention could not be read when this file was made.'
        : 'Nothing needs attention.',
  };
}

/** US-083, S-19 — one line's day, its Juniors, exceptions and watch lists. */
export function lineDocument(dashboard: LineDashboard): ExportDocument {
  if (dashboard.state === 'NO_LINE') {
    return {
      title: 'Line dashboard',
      filename: `rasi-line-${dashboard.businessDate}`,
      facts: [
        ['Business date', dashboard.businessDate],
        ['Line', 'No line is assigned to you on this date.'],
        generatedFact(dashboard.generatedAt),
      ],
      sections: [],
    };
  }
  const { line, day, pendingApprovals, nearingCompletion, overdue } = dashboard;
  const watchColumns: ExportColumn[] = [
    { header: 'Account', kind: 'text' },
    { header: 'Customer', kind: 'text' },
    { header: 'Daily amount', kind: 'money' },
    { header: 'Outstanding', kind: 'money' },
    { header: 'Target date', kind: 'date' },
    { header: 'Days overdue', kind: 'count' },
  ];
  const watchRows = (list: typeof overdue) =>
    (list?.items ?? []).map((account) => [
      account.accountCode,
      account.customerName,
      account.dailyAmount,
      account.outstanding,
      account.targetCompletionDate,
      account.daysOverdue,
    ]);
  const watchTitle = (title: string, list: typeof overdue) =>
    list && list.total > list.items.length
      ? `${title} (first ${list.items.length} of ${list.total})`
      : title;
  return {
    title: `Line dashboard · ${line.code} ${line.name}`,
    filename: `rasi-line-${line.code}-${dashboard.businessDate}`,
    facts: [
      ['Business date', dashboard.businessDate],
      ['Line', `${line.code} ${line.name}, ${line.sectorName}`],
      ...(day
        ? [
            ['Day', dayLabel(day.day)] as const,
            ['Status', humanize(day.status)] as const,
          ]
        : []),
      AMOUNTS_FACT,
      generatedFact(dashboard.generatedAt),
    ],
    sections: [
      {
        kind: 'figures',
        title: 'Today',
        figures: [
          money(
            'Expected',
            known(day, (d) => d.expected),
          ),
          money(
            'Collected',
            known(day, (d) => d.collected),
          ),
          money(
            'Shortfall',
            known(day, (d) => d.shortfall),
          ),
          money(
            'Surplus',
            known(day, (d) => d.surplus),
          ),
          money(
            'Cash received',
            known(day, (d) => d.cashReceived),
          ),
          money(
            'Cash difference',
            known(day, (d) => d.discrepancy),
          ),
          count(
            'Handovers waiting',
            known(day, (d) => d.handovers.waiting),
          ),
          count(
            'Handovers disputed',
            known(day, (d) => d.handovers.disputed),
          ),
          count(
            'Corrections waiting',
            known(pendingApprovals, (p) => p.total),
          ),
          count(
            'Nearing completion',
            known(nearingCompletion, (n) => n.total),
          ),
          count(
            'Overdue accounts',
            known(overdue, (o) => o.total),
          ),
        ],
      },
      {
        kind: 'table',
        title: 'Juniors',
        columns: [
          { header: 'Junior', kind: 'text' },
          { header: 'Entries', kind: 'count' },
          { header: 'Collected', kind: 'money' },
          { header: 'Phone', kind: 'text' },
          { header: 'Unsent', kind: 'count' },
        ],
        rows: (day?.juniors ?? []).map((junior) => [
          junior.name,
          junior.entries,
          junior.collectedAmount,
          humanize(junior.sync),
          junior.unsentCount,
        ]),
        empty:
          day === null
            ? 'The day could not be read when this file was made.'
            : 'No Junior on this line.',
      },
      {
        kind: 'table',
        title: 'Exceptions',
        columns: [
          { header: 'Kind', kind: 'text' },
          { header: 'Account', kind: 'text' },
          { header: 'Customer', kind: 'text' },
          { header: 'Expected', kind: 'money' },
          { header: 'Collected', kind: 'money' },
          { header: 'Collected by', kind: 'text' },
        ],
        rows: (day?.exceptions ?? []).map((exception) => [
          humanize(exception.kind),
          exception.accountCode,
          exception.customerName,
          exception.expectedAmount,
          // A missed or unvisited slot has no amount: a blank, not a zero.
          exception.amount ?? '',
          exception.collectedByName ?? '',
        ]),
        empty:
          day === null
            ? 'The day could not be read when this file was made.'
            : 'No exceptions.',
      },
      {
        kind: 'table',
        title: watchTitle('Nearing completion', nearingCompletion),
        columns: watchColumns,
        rows: watchRows(nearingCompletion),
        empty:
          nearingCompletion === null
            ? 'Could not be read when this file was made.'
            : 'No account is nearing completion.',
      },
      {
        kind: 'table',
        title: watchTitle('Overdue', overdue),
        columns: watchColumns,
        rows: watchRows(overdue),
        empty:
          overdue === null
            ? 'Could not be read when this file was made.'
            : 'No account is overdue.',
      },
    ],
  };
}
