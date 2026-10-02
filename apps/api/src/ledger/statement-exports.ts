import type {
  AccountStatement,
  BalanceSheet,
  ProfitAndLoss,
  TrialBalance,
} from '@repo/contracts';
import { toMoney } from '@repo/domain';

import type { ExportDocument } from '../exports/export-document.js';
import {
  AMOUNTS_FACT,
  generatedFact,
  humanize,
  periodFact,
  rangeStem,
} from '../exports/export-facts.js';

/**
 * Books slice 4 (ADR-0018): the statements and the trial balance as export
 * documents. Each is drawn from the same service call as its screen, so the
 * file and the page carry the same figures (M12).
 */

const ACCOUNT_LABEL: Record<
  TrialBalance['rows'][number]['accountType'],
  string
> = {
  CASH_AT_OFFICE: 'Cash in hand',
  BANK: 'Bank',
  CASH_IN_HAND: 'Cash in hand',
  LOAN_RECEIVABLE: 'Loans receivable',
  EXPENSE: 'Expense',
  WRITE_OFF_LOSS: 'Write-off loss',
  OWNER_DRAWINGS: 'Owner drawings',
  CAPITAL: 'Capital',
  UNEARNED_PROFIT: 'Unearned profit',
  EARNED_PROFIT: 'Earned profit',
  OTHER_INCOME: 'Other income',
};

export function trialBalanceDocument(trial: TrialBalance): ExportDocument {
  return {
    title: 'Trial balance',
    filename: `rasi-trial-balance-${trial.asOf}`,
    facts: [
      ['As of', trial.asOf],
      ['Balanced', trial.balanced ? 'Yes' : 'NO — report this as a defect'],
      AMOUNTS_FACT,
      generatedFact(trial.generatedAt),
    ],
    sections: [
      {
        kind: 'table',
        title: 'Trial balance',
        columns: [
          { header: 'Account', kind: 'text' },
          { header: 'Of', kind: 'text' },
          { header: 'Accounts', kind: 'count' },
          { header: 'Debits', kind: 'money' },
          { header: 'Credits', kind: 'money' },
          { header: 'Debit balance', kind: 'money' },
          { header: 'Credit balance', kind: 'money' },
        ],
        rows: trial.rows.map((row) => [
          ACCOUNT_LABEL[row.accountType],
          row.ownerName ?? row.referenceName ?? '',
          row.accounts,
          row.debits,
          row.credits,
          row.debitBalance,
          row.creditBalance,
        ]),
        totals: [
          'Total',
          '',
          '',
          '',
          '',
          trial.totals.debitBalance,
          trial.totals.creditBalance,
        ],
        empty: 'Nothing has been posted to the ledger by this date.',
      },
    ],
  };
}

export function profitAndLossDocument(pnl: ProfitAndLoss): ExportDocument {
  const lines: [string, string][] = [
    ['Earned profit on collections', pnl.income.earnedProfit],
    ['Other income', pnl.income.otherIncome],
    ['Total income', pnl.income.total],
    ...pnl.expenses.categories.map(
      (category) => [category.name, category.amount] as [string, string],
    ),
    ['Write-off loss', pnl.expenses.writeOffLoss],
    ['Total expenses', pnl.expenses.total],
    [pnl.netProfit.startsWith('-') ? 'Net loss' : 'Net profit', pnl.netProfit],
  ];
  return {
    title: 'Profit and loss',
    filename: rangeStem('profit-and-loss', pnl.from, pnl.to),
    facts: [
      periodFact(pnl.from, pnl.to),
      AMOUNTS_FACT,
      generatedFact(pnl.generatedAt),
    ],
    sections: [
      {
        kind: 'table',
        title: 'Profit and loss',
        columns: [
          { header: 'Line', kind: 'text' },
          { header: 'Amount', kind: 'money' },
        ],
        rows: lines,
      },
    ],
  };
}

/** A deduction, shown signed as the file's arithmetic reads it. */
function negative(amount: string): string {
  return toMoney(amount)
    .negated()
    .toFixed(2)
    .replace(/^-0\.00$/, '0.00');
}

export function balanceSheetDocument(sheet: BalanceSheet): ExportDocument {
  const { assets, equity } = sheet;
  return {
    title: 'Balance sheet',
    filename: `rasi-balance-sheet-${sheet.asOf}`,
    facts: [
      ['As of', sheet.asOf],
      ['Balanced', sheet.balanced ? 'Yes' : 'NO — report this as a defect'],
      AMOUNTS_FACT,
      generatedFact(sheet.generatedAt),
    ],
    sections: [
      {
        kind: 'table',
        title: 'What the business has',
        columns: [
          { header: 'Asset', kind: 'text' },
          { header: 'Amount', kind: 'money' },
        ],
        rows: [
          ['Cash in hand', assets.officeCash],
          ...assets.banks.map(
            (bank) => [bank.name, bank.balance] as [string, string],
          ),
          ...assets.cashWithStaff.map(
            (person) =>
              [`Cash with ${person.name}`, person.balance] as [string, string],
          ),
          ['Loans receivable', assets.loansReceivable],
          ['Less unearned profit', negative(assets.unearnedProfit)],
        ],
        totals: ['Total', assets.total],
      },
      {
        kind: 'table',
        title: 'Whose it is',
        columns: [
          { header: 'Equity', kind: 'text' },
          { header: 'Amount', kind: 'money' },
        ],
        rows: [
          ['Capital put in', equity.capital],
          ['Less owner drawings', negative(equity.drawings)],
          ['Retained profit', equity.retainedProfit],
        ],
        totals: ['Total', equity.total],
      },
    ],
  };
}

export function accountStatementDocument(
  statement: AccountStatement,
  stem: string,
): ExportDocument {
  return {
    title: `Statement · ${statement.account.name}`,
    filename: rangeStem(stem, statement.from, statement.to),
    facts: [
      ['Account', statement.account.name],
      periodFact(statement.from, statement.to),
      ['Opening balance', statement.opening],
      ['Closing balance', statement.closing],
      AMOUNTS_FACT,
      generatedFact(statement.generatedAt),
    ],
    sections: [
      {
        kind: 'table',
        title: 'Entries',
        columns: [
          { header: 'Date', kind: 'date' },
          { header: 'Type', kind: 'text' },
          { header: 'Description', kind: 'text' },
          { header: 'Debit', kind: 'money' },
          { header: 'Credit', kind: 'money' },
          { header: 'Balance', kind: 'money' },
        ],
        rows: statement.entries.map((entry) => [
          entry.businessDate,
          humanize(entry.transactionType),
          entry.description,
          entry.debit,
          entry.credit,
          entry.balance,
        ]),
        totals: [
          'Total',
          '',
          '',
          statement.totals.debits,
          statement.totals.credits,
          statement.closing,
        ],
        empty: 'Nothing moved in or out of this account in the period.',
      },
    ],
  };
}
