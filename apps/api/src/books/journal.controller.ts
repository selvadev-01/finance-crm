import { Controller } from '@nestjs/common';
import {
  journalContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { JournalService } from './journal.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** Books slice 5 (ADR-0018): the manual journal. Admins read; the owner posts. */
@Controller()
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @RequirePermission('ledger.view')
  @ContractRoute(api.listJournalEntries)
  listJournalEntries(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listJournalEntries'>,
  ): Out<'listJournalEntries'> {
    return this.journal.list(context, query);
  }

  @RequirePermission('journal.post')
  @ContractRoute(api.postJournalEntry)
  postJournalEntry(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'postJournalEntry'>,
  ): Out<'postJournalEntry'> {
    return this.journal.post(context, body);
  }
}
