import type {
  AccountStatement,
  BalanceSheet,
  ProfitAndLoss,
  TrialBalance,
} from '@repo/contracts';

import { renderCsv } from '../../src/exports/csv-renderer.js';
import type {
  ExportDocument,
  ExportTable,
} from '../../src/exports/export-document.js';
import {
  accountStatementDocument,
  balanceSheetDocument,
  profitAndLossDocument,
  trialBalanceDocument,
} from '../../src/ledger/statement-exports.js';

/**
 * Books slice 4 (ADR-0018): the statements' export documents carry the
 * screen's figures — signed where the statement subtracts — and render.
 */
const table = (document: ExportDocument, title: string) =>
  document.sections.find(
    (section): section is ExportTable =>
      section.kind === 'table' && section.title === title,
  )!;

const generatedAt = '2026-01-05T14:30:00.000Z';

describe('statement exports (ADR-0018)', () => {
  it('profit and loss lists income, each category and a loss by name', () => {
    const pnl: ProfitAndLoss = {
      from: '2026-01-01',
      to: '2026-01-05',
      generatedAt,
      income: { earnedProfit: '15.00', otherIncome: '200.00', total: '215.00' },
      expenses: {
        categories: [{ categoryId: 'c1', name: 'Rent', amount: '3000.00' }],
        writeOffLoss: '0.00',
        total: '3000.00',
      },
      netProfit: '-2785.00',
    };
    const document = profitAndLossDocument(pnl);
    expect(document.filename).toBe(
      'rasi-profit-and-loss-2026-01-01-to-2026-01-05',
    );
    expect(table(document, 'Profit and loss').rows).toEqual([
      ['Earned profit on collections', '15.00'],
      ['Other income', '200.00'],
      ['Total income', '215.00'],
      ['Rent', '3000.00'],
      ['Write-off loss', '0.00'],
      ['Total expenses', '3000.00'],
      ['Net loss', '-2785.00'],
    ]);
    expect(renderCsv(document).toString('utf8')).toContain('Net loss');
  });

  it('the balance sheet subtracts unearned profit and drawings, and totals both sides', () => {
    const sheet: BalanceSheet = {
      asOf: '2026-01-05',
      generatedAt,
      assets: {
        officeCash: '-500.00',
        banks: [{ id: 'b1', name: 'SBI Mylapore', balance: '5000.00' }],
        cashWithStaff: [{ id: 'u1', name: 'Selvi M', balance: '100.00' }],
        loansReceivable: '1900.00',
        unearnedProfit: '285.00',
        total: '6215.00',
      },
      equity: {
        capital: '10000.00',
        drawings: '0.00',
        retainedProfit: '-3785.00',
        total: '6215.00',
      },
      balanced: true,
    };
    const document = balanceSheetDocument(sheet);
    const assets = table(document, 'What the business has');
    expect(assets.rows).toContainEqual(['Less unearned profit', '-285.00']);
    expect(assets.rows).toContainEqual(['Cash with Selvi M', '100.00']);
    expect(assets.totals).toEqual(['Total', '6215.00']);
    // A zero deduction is 0.00, never "-0.00".
    expect(table(document, 'Whose it is').rows).toContainEqual([
      'Less owner drawings',
      '0.00',
    ]);
  });

  it('a statement keeps each entry with its running balance, and the trial balance its totals', () => {
    const statement: AccountStatement = {
      account: {
        ledgerAccountId: 'la1',
        accountType: 'CASH_AT_OFFICE',
        name: 'Cash in hand',
        normalBalance: 'DEBIT',
      },
      from: '2026-01-05',
      to: '2026-01-05',
      generatedAt,
      opening: '-1700.00',
      entries: [
        {
          ledgerTransactionId: 't1',
          businessDate: '2026-01-05',
          transactionType: 'CAPITAL',
          description: 'Opening capital',
          debit: '10000.00',
          credit: '0.00',
          balance: '8300.00',
        },
      ],
      totals: { debits: '10000.00', credits: '0.00' },
      closing: '8300.00',
    };
    const document = accountStatementDocument(statement, 'cash-book');
    expect(document.filename).toBe('rasi-cash-book-2026-01-05');
    expect(table(document, 'Entries').rows).toEqual([
      [
        '2026-01-05',
        'Capital',
        'Opening capital',
        '10000.00',
        '0.00',
        '8300.00',
      ],
    ]);

    const trial: TrialBalance = {
      asOf: '2026-01-05',
      generatedAt,
      rows: [
        {
          accountType: 'CAPITAL',
          ownerUserId: null,
          ownerName: null,
          referenceId: null,
          referenceName: null,
          accounts: 1,
          ledgerAccountId: 'la2',
          debits: '0.00',
          credits: '10000.00',
          debitBalance: '0.00',
          creditBalance: '10000.00',
        },
      ],
      totals: { debitBalance: '0.00', creditBalance: '10000.00' },
      balanced: false,
    };
    const trialDocument = trialBalanceDocument(trial);
    expect(trialDocument.facts).toContainEqual([
      'Balanced',
      'NO — report this as a defect',
    ]);
    expect(table(trialDocument, 'Trial balance').totals).toEqual([
      'Total',
      '',
      '',
      '',
      '',
      '0.00',
      '10000.00',
    ]);
  });
});
