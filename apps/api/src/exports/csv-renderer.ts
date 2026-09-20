import {
  type ExportDocument,
  type ExportFigures,
  type ExportTable,
  hasUnreadable,
  UNREADABLE_NOTE,
} from './export-document.js';

/**
 * The same document as one CSV file (US-087, Phase 2) — the format a business
 * opens in whatever it already has, and the only one of the three that can be
 * read without Excel or a PDF viewer.
 *
 * A CSV has no sheets, so the sections follow one another with a blank line
 * between, each under its own title. The heading rows say what the figures
 * are and over what range, because a file that outlives its download folder
 * has to explain itself.
 */
export function renderCsv(document: ExportDocument): Buffer {
  const lines: string[] = [
    row([document.title]),
    // The facts say what the figures cover — period, filters, when they were
    // read — and a file that outlives its download folder has to explain
    // itself.
    ...document.facts.map(([label, value]) => row([label, value])),
  ];
  if (hasUnreadable(document)) lines.push(row([UNREADABLE_NOTE]));

  for (const section of document.sections) {
    lines.push('');
    lines.push(
      ...(section.kind === 'figures' ? figures(section) : table(section)),
    );
  }

  // A byte-order mark, so Excel reads it as UTF-8 and rupee signs and Tamil
  // names survive the round trip rather than arriving as mojibake.
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

function figures(section: ExportFigures): string[] {
  return [
    row([section.title]),
    ...section.figures.map((figure) => row([figure.label, cell(figure.value)])),
  ];
}

function table(section: ExportTable): string[] {
  if (section.rows.length === 0 && section.empty) {
    return [row([section.title]), row([section.empty])];
  }
  return [
    row([section.title]),
    row(section.columns.map((column) => column.header)),
    ...section.rows.map((cells) => row(cells.map(cell))),
    ...(section.totals ? [row(section.totals.map(cell))] : []),
  ];
}

/**
 * `null` is "could not be read" (S-07) and is drawn as the same dash the
 * other renderers use, never as `0` or as nothing.
 */
function cell(value: string | number | null): string {
  if (value === null) return '—';
  return typeof value === 'number' ? String(value) : value;
}

const row = (cells: readonly string[]) => cells.map(escape).join(',');

/**
 * RFC 4180 quoting, and one thing it does not cover: a spreadsheet treats a
 * field starting `=`, `+`, `-` or `@` as a formula, so a customer named
 * `=cmd()` would execute on open. Text that looks like a formula is prefixed
 * with an apostrophe; a plain number is left alone, so `-20.00` stays a
 * negative number and still sums.
 */
function escape(value: string): string {
  const safe =
    /^[=+@\t\r]/.test(value) || (value.startsWith('-') && !isNumeric(value))
      ? `'${value}`
      : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const isNumeric = (value: string) => /^-?\d+(\.\d+)?$/.test(value);
