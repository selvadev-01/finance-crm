import ExcelJS from 'exceljs';

import type { ExportDocument } from '../../src/exports/export-document.js';
import { renderCsv } from '../../src/exports/csv-renderer.js';
import { renderPdf } from '../../src/exports/pdf-renderer.js';
import { renderXlsx } from '../../src/exports/xlsx-renderer.js';

/**
 * Both renderers draw one document (M12). The workbook is read back cell by
 * cell; the PDF is checked for what can be checked without a text extractor —
 * a valid file, the pages a long table needs, and the notes it must carry.
 */
function document(
  rows: number,
  overrides: Partial<ExportDocument> = {},
): ExportDocument {
  return {
    title: 'Line-wise report',
    filename: 'rasi-line-wise-2026-09-01-to-2026-09-19',
    facts: [
      ['Period', '2026-09-01 to 2026-09-19'],
      ['Amounts', 'Indian rupees (INR)'],
    ],
    sections: [
      {
        kind: 'figures',
        title: 'Today',
        figures: [
          { label: 'Expected', kind: 'money', value: '10000.00' },
          { label: 'Collected', kind: 'money', value: null },
          { label: 'Low entries', kind: 'count', value: 3 },
        ],
      },
      {
        kind: 'table',
        title: 'Lines',
        columns: [
          { header: 'Line', kind: 'text' },
          { header: 'Date', kind: 'date' },
          { header: 'Accounts', kind: 'count' },
          { header: 'Collected', kind: 'money' },
          { header: 'Last amount', kind: 'money' },
        ],
        rows: Array.from({ length: rows }, (_, index) => [
          `LN-${index + 1}`,
          '2026-09-19',
          index,
          index === 0 ? '333.33' : '-0.01',
          index === 0 ? null : '',
        ]),
        totals: ['Total', '', rows, '999999999999.99', null],
      },
    ],
    ...overrides,
  };
}

async function workbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ArrayBuffer);
  return book;
}

/** The row whose first cell reads `label`. */
function rowOf(sheet: ExcelJS.Worksheet, label: string): ExcelJS.Row {
  for (let index = 1; index <= sheet.rowCount; index += 1) {
    if (sheet.getRow(index).getCell(1).value === label)
      return sheet.getRow(index);
  }
  throw new Error(`no row ${label}`);
}

describe('xlsx renderer (M12 export)', () => {
  it('writes the figures to a Summary sheet and each table to its own', async () => {
    const book = await workbook(await renderXlsx(document(2)));
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Lines',
    ]);
    for (const sheet of book.worksheets) {
      expect(sheet.getCell(1, 1).value).toBe('Line-wise report');
    }
    const summary = book.getWorksheet('Summary')!;
    expect(rowOf(summary, 'Expected').getCell(2).value).toBe(10000);
    expect(rowOf(summary, 'Low entries').getCell(2).value).toBe(3);
  });

  it('writes money as exact number cells with two places, dates as dates', async () => {
    const sheet = (await workbook(await renderXlsx(document(2)))).getWorksheet(
      'Lines',
    )!;
    const first = rowOf(sheet, 'LN-1');
    expect(first.getCell(4).value).toBe(333.33);
    expect(first.getCell(4).numFmt).toContain('0.00');
    expect(first.getCell(2).value).toEqual(new Date(Date.UTC(2026, 8, 19)));
    expect(rowOf(sheet, 'LN-2').getCell(4).value).toBe(-0.01);
    expect(rowOf(sheet, 'Total').getCell(4).value).toBe(999999999999.99);
  });

  it('leaves an unknown figure empty — never 0 — and says why on every sheet (S-07)', async () => {
    const book = await workbook(await renderXlsx(document(2)));
    const summary = book.getWorksheet('Summary')!;
    expect(rowOf(summary, 'Collected').getCell(2).value).toBeNull();
    const sheet = book.getWorksheet('Lines')!;
    expect(rowOf(sheet, 'LN-1').getCell(5).value).toBeNull();
    for (const each of book.worksheets) {
      const texts: unknown[] = [];
      each.eachRow((row) => texts.push(row.getCell(1).value));
      expect(
        texts.some((text) => String(text).includes('unknown, not zero')),
      ).toBe(true);
    }
  });

  it('says nothing about unknowns when every figure was read', async () => {
    const complete = document(1, {
      sections: [
        {
          kind: 'table',
          title: 'Lines',
          columns: [{ header: 'Collected', kind: 'money' }],
          rows: [['1.00']],
        },
      ],
    });
    const sheet = (await workbook(await renderXlsx(complete))).worksheets[0]!;
    const texts: string[] = [];
    sheet.eachRow((row) => texts.push(String(row.getCell(1).value)));
    expect(texts.some((text) => text.includes('unknown, not zero'))).toBe(
      false,
    );
  });

  it('refuses to write a file from a document with a malformed cell', async () => {
    const broken = document(1, {
      sections: [
        {
          kind: 'table',
          title: 'Lines',
          columns: [{ header: 'Collected', kind: 'money' }],
          rows: [[1500]],
        },
      ],
    });
    await expect(renderXlsx(broken)).rejects.toThrow(/export cell of kind/);
  });
});

describe('pdf renderer (M12 export)', () => {
  const pages = (bytes: Buffer) =>
    bytes.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

  it('writes a PDF, one page for a short report', async () => {
    const bytes = await renderPdf(document(5));
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pages(bytes)).toBe(1);
  });

  it('runs a long table onto as many pages as it needs', async () => {
    expect(pages(await renderPdf(document(400)))).toBeGreaterThan(5);
  });

  it('refuses to write a file from a document with a malformed cell', async () => {
    const broken = document(1, {
      sections: [
        {
          kind: 'figures',
          title: 'Today',
          figures: [{ label: 'Expected', kind: 'money', value: '1.234' }],
        },
      ],
    });
    await expect(renderPdf(broken)).rejects.toThrow(/export cell of kind/);
  });

  it('draws a name in a script Helvetica lacks without failing', async () => {
    const tamil = document(1, {
      sections: [
        {
          kind: 'table',
          title: 'Customers',
          columns: [{ header: 'Customer', kind: 'text' }],
          rows: [['முருகன்']],
        },
      ],
    });
    const bytes = await renderPdf(tamil);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('CSV (US-087)', () => {
  const text = (doc: ExportDocument) => renderCsv(doc).toString('utf8');

  it('writes the title, the facts and each section in turn, with the same dash for what could not be read', () => {
    const csv = text(document(2));

    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Line-wise report');
    expect(lines[1]).toBe('Period,2026-09-01 to 2026-09-19');
    // Sections follow one another, each under its own title, separated by a
    // blank line: a CSV has no sheets.
    expect(lines).toContain('Today');
    expect(lines).toContain('Expected,10000.00');
    // S-07: a figure that could not be read is a dash, never a zero.
    expect(lines).toContain('Collected,—');
    expect(lines).toContain('Lines');
    expect(lines.some((line) => line.startsWith('Line,Date,'))).toBe(true);
  });

  it('quotes what RFC 4180 needs quoting, and defuses a field a spreadsheet would run as a formula', () => {
    const csv = text(
      document(0, {
        sections: [
          {
            kind: 'table',
            title: 'Customers',
            columns: [
              { header: 'Customer', kind: 'text' },
              { header: 'Note', kind: 'text' },
              { header: 'Variance', kind: 'money' },
            ],
            rows: [
              ['Kumar, S.', 'Said "later"', '-20.00'],
              ['=1+1', 'line one\nline two', '0.00'],
            ],
          },
        ],
      }),
    );

    expect(csv).toContain('"Kumar, S.","Said ""later""",-20.00');
    // A name that looks like a formula is prefixed so nothing runs on open;
    // a negative amount is left alone, so it still reads as a number.
    // Prefixed, and quoted only where RFC 4180 asks for it — which this is not.
    expect(csv).toContain("'=1+1,");
    expect(csv).toContain('"line one\nline two"');
  });

  it('says an empty table is empty rather than printing a bare header', () => {
    const csv = text(
      document(0, {
        sections: [
          {
            kind: 'table',
            title: 'Overdue accounts',
            columns: [{ header: 'Customer', kind: 'text' }],
            rows: [],
            empty: 'Nobody is overdue.',
          },
        ],
      }),
    );
    expect(csv).toContain('Nobody is overdue.');
  });
});
