import { Controller } from '@nestjs/common';
import {
  booksMoneyContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { BooksMoneyService } from './books-money.service.js';
import { FieldExpenseService } from './field-expense.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** Books slice 2 (ADR-0018). Scope is applied inside the service (M02). */
@Controller()
export class BooksMoneyController {
  constructor(
    private readonly money: BooksMoneyService,
    private readonly field: FieldExpenseService,
  ) {}

  @RequirePermission('ledger.view')
  @ContractRoute(api.getBooksOverview)
  getBooksOverview(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'getBooksOverview'>,
  ): Out<'getBooksOverview'> {
    return this.money.overview(context, query);
  }

  @RequirePermission('expense.view')
  @ContractRoute(api.listExpenses)
  listExpenses(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listExpenses'>,
  ): Out<'listExpenses'> {
    return this.money.listExpenses(context, query);
  }

  @RequirePermission('expense.record')
  @ContractRoute(api.recordExpense)
  recordExpense(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'recordExpense'>,
  ): Out<'recordExpense'> {
    return this.money.recordExpense(context, body);
  }

  @RequirePermission('expense.requestField')
  @ContractRoute(api.requestFieldExpense)
  requestFieldExpense(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'requestFieldExpense'>,
  ): Out<'requestFieldExpense'> {
    return this.field.request(context, body);
  }

  @RequirePermission('expense.approve')
  @ContractRoute(api.decideExpense)
  decideExpense(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'decideExpense'>,
  ): Out<'decideExpense'> {
    return this.field.decide(context, params.expenseId, body);
  }

  @RequirePermission('ledger.view')
  @ContractRoute(api.listBankTransfers)
  listBankTransfers(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listBankTransfers'>,
  ): Out<'listBankTransfers'> {
    return this.money.listBankTransfers(context, query);
  }

  @RequirePermission('bank.transfer')
  @ContractRoute(api.recordBankTransfer)
  recordBankTransfer(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'recordBankTransfer'>,
  ): Out<'recordBankTransfer'> {
    return this.money.recordBankTransfer(context, body);
  }

  @RequirePermission('ledger.view')
  @ContractRoute(api.listOtherIncome)
  listOtherIncome(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listOtherIncome'>,
  ): Out<'listOtherIncome'> {
    return this.money.listOtherIncome(context, query);
  }

  @RequirePermission('income.record')
  @ContractRoute(api.recordOtherIncome)
  recordOtherIncome(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'recordOtherIncome'>,
  ): Out<'recordOtherIncome'> {
    return this.money.recordOtherIncome(context, body);
  }

  @RequirePermission('ledger.view')
  @ContractRoute(api.listDrawings)
  listDrawings(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listDrawings'>,
  ): Out<'listDrawings'> {
    return this.money.listDrawings(context, query);
  }

  @RequirePermission('drawings.record')
  @ContractRoute(api.recordDrawing)
  recordDrawing(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'recordDrawing'>,
  ): Out<'recordDrawing'> {
    return this.money.recordDrawing(context, body);
  }
}
