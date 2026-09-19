import PDFDocument from 'pdfkit';

import { assertCell, formatCount, formatMoney } from './export-cells.js';
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
 * The PDF side of an export (M12): A4 landscape, for printing and sending on.
 * Amounts are drawn from their decimal strings with Indian grouping; a figure
 * that could not be read is a dash with the note, never `0` (S-07). A table
 * that runs past a page repeats its header row, and every page is numbered.
 *
 * **Latin script only.** The PDF uses the built-in Helvetica, which cannot
 * draw Tamil or Devanagari; a character it cannot draw becomes `?` and the
 * file says so. The Excel file carries every name as written.
 */

type Doc = PDFKit.PDFDocument;

const MARGIN = 36;
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const INK = '#1f2933';
const MUTED = '#5f6b76';
const RULE = '#d5dbe0';
const HEADER_FILL = '#eef2f4';
const CELL_PAD = 3;

const UNREADABLE = '—';
const LATIN_ONLY_NOTE =
  'Some names use a script this PDF cannot draw and show as ?. The Excel export shows them as written.';

export async function renderPdf(document: ExportDocument): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: document.title, Creator: 'Rasi' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const text = new Latin1Text();
  writeHeading(doc, document, text);
  for (const section of document.sections) {
    if (section.kind === 'figures') writeFigures(doc, section, text);
    else writeTable(doc, section, text);
  }
  const notes = [
    ...(hasUnreadable(document) ? [UNREADABLE_NOTE] : []),
    ...(text.replaced ? [LATIN_ONLY_NOTE] : []),
  ];
  if (notes.length > 0) {
    ensureSpace(doc, 14 * notes.length + 8);
    doc.moveDown(0.5);
    for (const note of notes) {
      doc
        .font(FONT)
        .fontSize(8)
        .fillColor(MUTED)
        .text(note, MARGIN, doc.y, {
          width: contentWidth(doc),
        });
    }
  }
  numberPages(doc, text.of(document.title));
  doc.end();
  return finished;
}

function writeHeading(
  doc: Doc,
  document: ExportDocument,
  text: Latin1Text,
): void {
  doc
    .font(BOLD)
    .fontSize(16)
    .fillColor(INK)
    .text(text.of(document.title), MARGIN, MARGIN);
  doc.moveDown(0.3);
  doc.fontSize(9);
  for (const [label, value] of document.facts) {
    doc
      .font(BOLD)
      .fillColor(MUTED)
      .text(`${text.of(label)}: `, MARGIN, doc.y, { continued: true })
      .font(FONT)
      .fillColor(INK)
      .text(text.of(value));
  }
  doc.moveDown(0.8);
}

function writeFigures(
  doc: Doc,
  section: ExportFigures,
  text: Latin1Text,
): void {
  const labelWidth = 230;
  const valueWidth = 110;
  ensureSpace(doc, 40);
  sectionTitle(doc, section.title, text);
  doc.fontSize(9);
  for (const figure of section.figures) {
    ensureSpace(doc, 14);
    const y = doc.y;
    doc.font(FONT).fillColor(MUTED).text(text.of(figure.label), MARGIN, y, {
      width: labelWidth,
    });
    const after = doc.y;
    doc
      .font(BOLD)
      .fillColor(INK)
      .text(display(figure.kind, figure.value, text), MARGIN + labelWidth, y, {
        width: valueWidth,
        align: figure.kind === 'text' ? 'left' : 'right',
      });
    doc.y = Math.max(after, doc.y) + 2;
  }
  doc.moveDown(0.8);
}

function writeTable(doc: Doc, section: ExportTable, text: Latin1Text): void {
  const fontSize = section.columns.length > 10 ? 7 : 8;
  const headers = section.columns.map((column) => text.of(column.header));
  const body = section.rows.map((row) =>
    section.columns.map((column, index) =>
      display(column.kind, row[index] ?? null, text),
    ),
  );
  const totals = section.totals
    ? section.columns.map((column, index) =>
        display(column.kind, section.totals?.[index] ?? null, text),
      )
    : null;
  const widths = columnWidths(doc, section, headers, body, totals, fontSize);
  const align = section.columns.map((column) =>
    column.kind === 'text' ? ('left' as const) : ('right' as const),
  );

  ensureSpace(doc, 60);
  sectionTitle(doc, section.title, text);
  drawHeader(doc, headers, widths, align, fontSize);

  if (body.length === 0) {
    doc
      .font(FONT)
      .fontSize(fontSize + 1)
      .fillColor(MUTED)
      .text(
        text.of(section.empty ?? 'No rows.'),
        MARGIN + CELL_PAD,
        doc.y + CELL_PAD,
      );
    doc.moveDown(1);
    return;
  }

  for (const cells of body) {
    const height = rowHeight(doc, cells, widths, FONT, fontSize);
    if (doc.y + height > pageBottom(doc)) {
      doc.addPage();
      drawHeader(doc, headers, widths, align, fontSize);
    }
    drawRow(doc, cells, widths, align, FONT, fontSize, height);
  }
  if (totals) {
    const height = rowHeight(doc, totals, widths, BOLD, fontSize);
    if (doc.y + height > pageBottom(doc)) {
      doc.addPage();
      drawHeader(doc, headers, widths, align, fontSize);
    }
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + sum(widths), doc.y)
      .lineWidth(0.8)
      .strokeColor(INK)
      .stroke();
    drawRow(doc, totals, widths, align, BOLD, fontSize, height);
  }
  doc.moveDown(1);
}

function drawHeader(
  doc: Doc,
  headers: string[],
  widths: number[],
  align: ('left' | 'right')[],
  fontSize: number,
): void {
  const height = rowHeight(doc, headers, widths, BOLD, fontSize);
  doc.rect(MARGIN, doc.y, sum(widths), height).fill(HEADER_FILL);
  drawRow(doc, headers, widths, align, BOLD, fontSize, height);
}

function drawRow(
  doc: Doc,
  cells: string[],
  widths: number[],
  align: ('left' | 'right')[],
  font: string,
  fontSize: number,
  height: number,
): void {
  const top = doc.y;
  let x = MARGIN;
  doc.font(font).fontSize(fontSize).fillColor(INK);
  cells.forEach((cell, index) => {
    const width = widths[index] ?? 0;
    doc.text(cell, x + CELL_PAD, top + CELL_PAD, {
      width: width - CELL_PAD * 2,
      align: align[index] ?? 'left',
    });
    x += width;
  });
  const bottom = top + height;
  doc
    .moveTo(MARGIN, bottom)
    .lineTo(MARGIN + sum(widths), bottom)
    .lineWidth(0.4)
    .strokeColor(RULE)
    .stroke();
  doc.x = MARGIN;
  doc.y = bottom;
}

function rowHeight(
  doc: Doc,
  cells: string[],
  widths: number[],
  font: string,
  fontSize: number,
): number {
  doc.font(font).fontSize(fontSize);
  const tallest = cells.reduce(
    (height, cell, index) =>
      Math.max(
        height,
        doc.heightOfString(cell || ' ', {
          width: (widths[index] ?? 0) - CELL_PAD * 2,
        }),
      ),
    0,
  );
  return tallest + CELL_PAD * 2;
}

/**
 * Each column as wide as its longest cell (sampled) or header word, text
 * columns capped, then all scaled down together if the table is wider than
 * the page. Numbers never wrap at the widths this gives them.
 */
function columnWidths(
  doc: Doc,
  section: ExportTable,
  headers: string[],
  body: string[][],
  totals: string[] | null,
  fontSize: number,
): number[] {
  const sample = [...body.slice(0, 300), ...(totals ? [totals] : [])];
  const natural = section.columns.map((column, index) => {
    doc.font(FONT).fontSize(fontSize);
    const widest = sample.reduce(
      (width, row) => Math.max(width, doc.widthOfString(row[index] ?? '')),
      0,
    );
    doc.font(BOLD);
    const headerWord = Math.max(
      ...(headers[index] ?? '')
        .split(/\s+/)
        .map((word) => doc.widthOfString(word)),
    );
    const cap = column.kind === 'text' ? 170 : 110;
    return Math.min(Math.max(widest, headerWord, 28), cap) + CELL_PAD * 2;
  });
  const available = contentWidth(doc);
  const total = sum(natural);
  return total <= available
    ? natural
    : natural.map((width) => (width * available) / total);
}

function sectionTitle(doc: Doc, title: string, text: Latin1Text): void {
  doc
    .font(BOLD)
    .fontSize(11)
    .fillColor(INK)
    .text(text.of(title), MARGIN, doc.y);
  doc.moveDown(0.3);
}

function display(
  kind: ColumnKind,
  value: ExportCell,
  text: Latin1Text,
): string {
  assertCell(kind, value);
  if (value === null) return UNREADABLE;
  if (value === '') return '';
  switch (kind) {
    case 'money':
      return formatMoney(value as string);
    case 'count':
      return formatCount(value as number);
    default:
      return text.of(String(value));
  }
}

function numberPages(doc: Doc, title: string): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // Writing below the bottom margin would otherwise start a new page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font(FONT)
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `Rasi · ${title} · Page ${index - range.start + 1} of ${range.count}`,
        MARGIN,
        doc.page.height - MARGIN + 10,
        { width: contentWidth(doc), align: 'right', lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
}

function ensureSpace(doc: Doc, height: number): void {
  if (doc.y + height > pageBottom(doc)) doc.addPage();
}

function pageBottom(doc: Doc): number {
  return doc.page.height - doc.page.margins.bottom;
}

function contentWidth(doc: Doc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Helvetica draws WinAnsi (Latin-1 and a few typographic marks) only. Anything
 * else would come out as garbage glyphs, so it becomes `?` — and `replaced`
 * tells the renderer to say so in the file.
 */
class Latin1Text {
  replaced = false;

  of(value: string): string {
    return value.replace(/[^ -~ -ÿ–—‘’“”•…·]/g, () => {
      this.replaced = true;
      return '?';
    });
  }
}
