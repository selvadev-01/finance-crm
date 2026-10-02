import { Module } from '@nestjs/common';

import { CashModule } from '../cash/cash.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { BankAccountService } from './bank-account.service.js';
import { BooksMoneyController } from './books-money.controller.js';
import { BooksMoneyService } from './books-money.service.js';
import { BooksController } from './books.controller.js';
import { ExpenseCategoryService } from './expense-category.service.js';
import { FieldExpenseService } from './field-expense.service.js';
import { JournalController } from './journal.controller.js';
import { JournalService } from './journal.service.js';

/**
 * Books (ADR-0018): the business's own money beside the loan book — expense
 * categories and bank accounts, office and field expenses, transfers, other
 * income, drawings and the manual journal. The statements are in the ledger
 * module, which reads them from its entries.
 */
@Module({
  imports: [LedgerModule, CashModule],
  controllers: [BooksController, BooksMoneyController, JournalController],
  providers: [
    ExpenseCategoryService,
    BankAccountService,
    BooksMoneyService,
    FieldExpenseService,
    JournalService,
  ],
  exports: [ExpenseCategoryService, BankAccountService, BooksMoneyService],
})
export class BooksModule {}
