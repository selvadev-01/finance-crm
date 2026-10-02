import { Controller } from '@nestjs/common';
import {
  booksContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { BankAccountService } from './bank-account.service.js';
import { ExpenseCategoryService } from './expense-category.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** Books (ADR-0018). Scope is applied inside each service (M02). */
@Controller()
export class BooksController {
  constructor(
    private readonly categories: ExpenseCategoryService,
    private readonly banks: BankAccountService,
  ) {}

  @RequirePermission('expense.view')
  @ContractRoute(api.listExpenseCategories)
  listExpenseCategories(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listExpenseCategories'>,
  ): Out<'listExpenseCategories'> {
    return this.categories.list(context, query);
  }

  @RequirePermission('expenseCategory.manage')
  @ContractRoute(api.createExpenseCategory)
  createExpenseCategory(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'createExpenseCategory'>,
  ): Out<'createExpenseCategory'> {
    return this.categories.create(context, body);
  }

  @RequirePermission('expenseCategory.manage')
  @ContractRoute(api.updateExpenseCategory)
  updateExpenseCategory(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'updateExpenseCategory'>,
  ): Out<'updateExpenseCategory'> {
    return this.categories.update(context, params.categoryId, body);
  }

  @RequirePermission('ledger.view')
  @ContractRoute(api.listBankAccounts)
  listBankAccounts(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listBankAccounts'>,
  ): Out<'listBankAccounts'> {
    return this.banks.list(context, query);
  }

  @RequirePermission('bank.manage')
  @ContractRoute(api.createBankAccount)
  createBankAccount(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'createBankAccount'>,
  ): Out<'createBankAccount'> {
    return this.banks.create(context, body);
  }

  @RequirePermission('bank.manage')
  @ContractRoute(api.updateBankAccount)
  updateBankAccount(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'updateBankAccount'>,
  ): Out<'updateBankAccount'> {
    return this.banks.update(context, params.bankAccountId, body);
  }
}
