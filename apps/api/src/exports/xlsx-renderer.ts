import { toUtcMidnight, parseCalendarDate } from '@repo/domain';
import ExcelJS from 'exceljs';

import { assertCell, excelNumber } from './export-cells.js';
import {
  type ColumnKind,
  type ExportCell,
  type ExportDocument,
  type ExportFigures,
  type ExportTable,
  hasUnreadable,
  UNREADABLE_NOTE,
} from './export-document.js';

/**
 * The Excel side of an export (M12): a workbook a person can sort, filter
 * and sum. Money is a real number cell with two places (proven exact by
 * `excelNumber`), dates are real date cells, and a figure that could not be
 * read is an empty cell with the note on every sheet — never `0` (S-07).
 *
 * Layout: a **Summary** sheet with the headline figures, when there are any,
 * then one sheet per table with a frozen header row and a filter on it. Every
 * sheet opens with the title and what the figures cover, so a sheet copied
 * out of the workbook still says what it is.
 */

const MONEY_FORMAT = '#,##0.00;-#,##0.00';
const COUNT_FORMAT = '#,##0';
const DATE_FORMAT = 'dd-mmm-yyyy';

export async function renderXlsx(document: ExportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Rasi';
  const note = hasUnreadable(document) ? UNREADABLE_NOTE : null;
  const names = new Set<string>();

  const figures = document.sections.filter(
    (section): section is ExportFigures => section.kind === 'figures',
  );
  if (figures.length > 0) {
    const sheet = workbook.addWorksheet(sheetName('Summary', names));
    let row = writeHeading(sheet, document, note);
    for (const section of figures) row = writeFigures(sheet, section, row);
    sheet.getColumn(1).width = 34;
    sheet.getColumn(2).width = 20;
  }

  for (const section of document.sections) {
    if (section.kind !== 'table') continue;
    const sheet = workbook.addWorksheet(sheetName(section.title, names));
    writeTable(sheet, section, writeHeading(sheet, document, note));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Title, facts and the note; returns the next free row. */
function writeHeading(
  sheet: ExcelJS.Worksheet,
  document: ExportDocument,
  note: string | null,
): number {
  sheet.getCell(1, 1).value = document.title;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  let row = 2;
  for (const [label, value] of document.facts) {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { bold: true };
    sheet.getCell(row, 2).value = value;
    row += 1;
  }
  if (note) {
    sheet.getCell(row, 1).value = note;
    sheet.getCell(row, 1).font = { italic: true };
    row += 1;
  }
  return row + 1;
}

function writeFigures(
  sheet: ExcelJS.Worksheet,
  section: ExportFigures,
  start: number,
): number {
  sheet.getCell(start, 1).value = section.title;
  sheet.getCell(start, 1).font = { bold: true, size: 12 };
  let row = start + 1;
  for (const figure of section.figures) {
    sheet.getCell(row, 1).value = figure.label;
    writeCell(sheet.getCell(row, 2), figure.kind, figure.value);
    row += 1;
  }
  return row + 1;
}

function writeTable(
  sheet: ExcelJS.Worksheet,
  section: ExportTable,
  start: number,
): void {
  sheet.getCell(start, 1).value = section.title;
  sheet.getCell(start, 1).font = { bold: true, size: 12 };
  const headerRow = start + 1;
  section.columns.forEach((column, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = column.header;
    cell.font = { bold: true };
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = {
      wrapText: true,
      vertical: 'bottom',
      horizontal: column.kind === 'text' ? 'left' : 'right',
    };
    sheet.getColumn(index + 1).width = columnWidth(column.kind, column.header);
  });

  if (section.rows.length === 0) {
    sheet.getCell(headerRow + 1, 1).value = section.empty ?? 'No rows.';
    return;
  }

  section.rows.forEach((values, rowIndex) => {
    section.columns.forEach((column, index) =>
      writeCell(
        sheet.getCell(headerRow + 1 + rowIndex, index + 1),
        column.kind,
        values[index] ?? null,
      ),
    );
  });
  const lastRow = headerRow + section.rows.length;

  if (section.totals) {
    const totalsRow = lastRow + 1;
    section.columns.forEach((column, index) => {
      const cell = sheet.getCell(totalsRow, index + 1);
      writeCell(cell, column.kind, section.totals?.[index] ?? null);
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin' } };
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: lastRow, column: section.columns.length },
  };
}

function writeCell(
  cell: ExcelJS.Cell,
  kind: ColumnKind,
  value: ExportCell,
): void {
  assertCell(kind, value);
  if (value === null || value === '') return;
  switch (kind) {
    case 'money':
      cell.value = excelNumber(value as string);
      cell.numFmt = MONEY_FORMAT;
      return;
    case 'count':
      cell.value = value;
      cell.numFmt = COUNT_FORMAT;
      return;
    case 'date':
      // UTC midnight: Excel dates have no zone, and this is the date itself.
      cell.value = toUtcMidnight(parseCalendarDate(value as string));
      cell.numFmt = DATE_FORMAT;
      return;
    case 'text':
      cell.value = value;
  }
}

function columnWidth(kind: ColumnKind, header: string): number {
  const base = kind === 'text' ? 24 : kind === 'money' ? 16 : 12;
  return Math.min(Math.max(base, Math.ceil(header.length * 0.9)), 40);
}

/** Excel's rules: at most 31 characters, none of `[]:*?/\`, unique. */
function sheetName(title: string, taken: Set<string>): string {
  const clean =
    title
      .replace(/[[\]:*?/\\]/g, ' ')
      .slice(0, 28)
      .trim() || 'Sheet';
  let name = clean;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${clean} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}
