import type { ExportFormat } from '@repo/contracts';

/**
 * What an export says, independent of the file it becomes (M12). Each view
 * is turned into one of these by its own builder, and both renderers
 * (`xlsx-renderer.ts`, `pdf-renderer.ts`) draw the same document — so the
 * Excel and PDF of a report can never carry different figures.
 */

/** How a column's cells are written, and what they must hold. */
export type ColumnKind =
  /** Free text. */
  | 'text'
  /** A decimal string, signed or not, at most two places (BR-11). Never a number. */
  | 'money'
  /** A whole number. */
  | 'count'
  /** A business date, `YYYY-MM-DD`. */
  | 'date';

export interface ExportColumn {
  header: string;
  kind: ColumnKind;
}

/**
 * One cell. `null` is "could not be read" (S-07) — drawn as a dash with a
 * note, never as `0`. An empty string, in a column of any kind, is "nothing
 * here, and that is a fact" — an account never visited has no last-visit
 * date — and is drawn blank.
 */
export type ExportCell = string | number | null;

export interface ExportTable {
  kind: 'table';
  title: string;
  columns: readonly ExportColumn[];
  rows: readonly (readonly ExportCell[])[];
  /** The totals row, in the columns' order; `null` cells where unknown. */
  totals?: readonly ExportCell[];
  /** Said instead of an empty table. */
  empty?: string;
}

export interface ExportFigure {
  label: string;
  kind: ColumnKind;
  value: ExportCell;
}

/** Headline figures: a label and one value each, as a dashboard shows them. */
export interface ExportFigures {
  kind: 'figures';
  title: string;
  figures: readonly ExportFigure[];
}

export type ExportSection = ExportTable | ExportFigures;

export interface ExportDocument {
  /** `Line-wise report`. */
  title: string;
  /** The file's name without its extension: `rasi-line-wise-2026-09-01-to-2026-09-19`. */
  filename: string;
  /** What the figures cover — period, filters, when they were read. */
  facts: readonly (readonly [label: string, value: string])[];
  sections: readonly ExportSection[];
}

/** An export as delivered: its bytes, name and media type. */
export interface RenderedExport {
  bytes: Buffer;
  filename: string;
  contentType: string;
}

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
};

/** Said wherever a `null` was drawn, so a dash is never read as nothing. */
export const UNREADABLE_NOTE =
  '— marks a figure that could not be read when this file was made. It is unknown, not zero.';

/** Every table row in the document: what the row limit and the audit entry count. */
export function rowCount(document: ExportDocument): number {
  return document.sections.reduce(
    (total, section) =>
      total + (section.kind === 'table' ? section.rows.length : 0),
    0,
  );
}

/** Whether any cell or figure is `null`, so the unreadable note is needed. */
export function hasUnreadable(document: ExportDocument): boolean {
  return document.sections.some((section) =>
    section.kind === 'table'
      ? section.rows.some((row) => row.includes(null)) ||
        (section.totals?.includes(null) ?? false)
      : section.figures.some((figure) => figure.value === null),
  );
}
