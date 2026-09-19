import type { CollectionListItem } from '@repo/contracts';

import { formatInstant } from '../exports/export-cells.js';
import type { ExportDocument } from '../exports/export-document.js';
import {
  AMOUNTS_FACT,
  filterFact,
  humanize,
  periodFact,
  rangeStem,
} from '../exports/export-facts.js';

interface CollectionListFilters {
  from: string;
  to: string;
  lineId?: string;
  accountLoanId?: string;
  entryType?: string;
  status?: string;
}

/**
 * The collection list (S-16) as an export document: every entry matching the
 * screen's filters, one row each, in the list's own order. Adjustments are
 * rows of their own (non-negotiable 4), so the file shows a correction the
 * way the list does — beside the entry it corrects, never folded into it.
 */
export function collectionListDocument(
  rows: readonly CollectionListItem[],
  filters: CollectionListFilters,
  generatedAt: Date,
): ExportDocument {
  const first = rows[0];
  return {
    title: 'Collections',
    filename: rangeStem('collections', filters.from, filters.to),
    facts: [
      periodFact(filters.from, filters.to),
      ...filterFact('Line', filters.lineId, first?.lineName),
      ...filterFact(
        'Account',
        filters.accountLoanId,
        first ? `${first.accountCode} ${first.customerName}` : undefined,
      ),
      ...(filters.entryType
        ? [['Entry', humanize(filters.entryType)] as const]
        : []),
      ...(filters.status
        ? [['Status', humanize(filters.status)] as const]
        : []),
      AMOUNTS_FACT,
      ['Generated', formatInstant(generatedAt)],
    ],
    sections: [
      {
        kind: 'table',
        title: 'Collections',
        columns: [
          { header: 'Date', kind: 'date' },
          { header: 'Account', kind: 'text' },
          { header: 'Customer', kind: 'text' },
          { header: 'Line', kind: 'text' },
          { header: 'Collected by', kind: 'text' },
          { header: 'Entry', kind: 'text' },
          { header: 'Status', kind: 'text' },
          { header: 'Expected', kind: 'money' },
          { header: 'Amount', kind: 'money' },
          { header: 'Variance', kind: 'money' },
          { header: 'Class', kind: 'text' },
          { header: 'Captured', kind: 'text' },
          { header: 'Note', kind: 'text' },
        ],
        rows: rows.map((row) => [
          row.businessDate,
          row.accountCode,
          row.customerName,
          row.lineName,
          row.collectedByName,
          row.entryType === 'ADJUSTMENT' ? 'Correction' : 'Visit',
          humanize(row.status),
          // An adjustment is not measured against a slot (its 0.00 is not an expectation).
          row.entryType === 'ADJUSTMENT' ? '' : row.expectedAmount,
          row.amount,
          row.variance,
          humanize(row.classification),
          formatInstant(row.capturedAt),
          row.note ?? '',
        ]),
        empty: 'No collection matches these filters.',
      },
    ],
  };
}
