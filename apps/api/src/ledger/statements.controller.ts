import { Controller, StreamableFile } from '@nestjs/common';
import {
  exportContract as download,
  statementsContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import { ExportService } from '../exports/export.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import {
  accountStatementDocument,
  balanceSheetDocument,
  profitAndLossDocument,
  trialBalanceDocument,
} from './statement-exports.js';
import { StatementsService } from './statements.service.js';
import { TrialBalanceService } from './trial-balance.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;
type Download<Route extends keyof typeof download> = RouteInput<
  (typeof download)[Route]
>;

/**
 * Books slice 4 (ADR-0018): the statements and their exports, read-only and
 * under `ledger.view` like the rest of the ledger. Each export reads through
 * the same service call as its screen, then `ExportService` renders it and
 * records the EXPORT (M12, M13).
 */
@Controller()
export class StatementsController {
  constructor(
    private readonly statements: StatementsService,
    private readonly trialBalance: TrialBalanceService,
    private readonly exporter: ExportService,
  ) {}

  @RequirePermission('ledger.view')
  @ContractRoute(api.getProfitAndLoss)
  getProfitAndLoss(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'getProfitAndLoss'>,
  ): Out<'getProfitAndLoss'> {
    return this.statements.profitAndLoss(context, query);
  }

  @RequirePermission('ledger.view')
  @ContractRoute(api.getBalanceSheet)
  getBalanceSheet(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'getBalanceSheet'>,
  ): Out<'getBalanceSheet'> {
    return this.statements.balanceSheet(context, query);
  }

  @RequirePermission('ledger.view')
  @ContractRoute(api.getAccountStatement)
  getAccountStatement(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, query }: In<'getAccountStatement'>,
  ): Out<'getAccountStatement'> {
    return this.statements.accountStatement(
      context,
      params.ledgerAccountId,
      query,
    );
  }

  @RequirePermission('ledger.view')
  @ContractRoute(api.getCashBook)
  getCashBook(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'getCashBook'>,
  ): Out<'getCashBook'> {
    return this.statements.cashBook(context, query);
  }

  // ---------------------------------------------------------------- Export

  @RequirePermission('ledger.view')
  @ContractRoute(download.trialBalance)
  async exportTrialBalance(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    { query: { format, ...filters } }: Download<'trialBalance'>,
  ): Promise<StreamableFile> {
    const trial = await this.trialBalance.trialBalance(context, filters);
    return this.exporter.deliver(
      context,
      { name: 'ledger/trial-balance', format, filters },
      trialBalanceDocument(trial),
    );
  }

  @RequirePermission('ledger.view')
  @ContractRoute(download.profitAndLoss)
  async exportProfitAndLoss(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    { query: { format, ...filters } }: Download<'profitAndLoss'>,
  ): Promise<StreamableFile> {
    const pnl = await this.statements.profitAndLoss(context, filters);
    return this.exporter.deliver(
      context,
      { name: 'books/profit-and-loss', format, filters },
      profitAndLossDocument(pnl),
    );
  }

  @RequirePermission('ledger.view')
  @ContractRoute(download.balanceSheet)
  async exportBalanceSheet(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    { query: { format, ...filters } }: Download<'balanceSheet'>,
  ): Promise<StreamableFile> {
    const sheet = await this.statements.balanceSheet(context, filters);
    return this.exporter.deliver(
      context,
      { name: 'books/balance-sheet', format, filters },
      balanceSheetDocument(sheet),
    );
  }

  @RequirePermission('ledger.view')
  @ContractRoute(download.accountStatement)
  async exportAccountStatement(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    { params, query: { format, ...filters } }: Download<'accountStatement'>,
  ): Promise<StreamableFile> {
    const statement = await this.statements.accountStatement(
      context,
      params.ledgerAccountId,
      filters,
    );
    return this.exporter.deliver(
      context,
      {
        name: 'ledger/account-statement',
        format,
        filters: { ...filters, ledgerAccountId: params.ledgerAccountId },
      },
      accountStatementDocument(statement, 'statement'),
    );
  }

  @RequirePermission('ledger.view')
  @ContractRoute(download.cashBook)
  async exportCashBook(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query: { format, ...filters } }: Download<'cashBook'>,
  ): Promise<StreamableFile> {
    const book = await this.statements.cashBook(context, filters);
    return this.exporter.deliver(
      context,
      { name: 'books/cash-book', format, filters },
      accountStatementDocument(book, 'cash-book'),
    );
  }
}
