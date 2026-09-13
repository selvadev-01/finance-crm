import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@repo/db';

/** Injection token for the base Prisma client. Tier 1 tests override it. */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

export interface TransactionOptions {
  /** Longest wait for a connection before giving up. */
  maxWait?: number;
  /** Longest the transaction may stay open. Money transactions are kept short. */
  timeout?: number;
}

/**
 * Explicit, and shorter than a request timeout: a transaction holding locks
 * for longer than this is a bug to surface, not a load spike to wait out.
 */
const DEFAULT_TRANSACTION_OPTIONS = {
  maxWait: 2_000,
  timeout: 5_000,
} satisfies TransactionOptions;

/**
 * Database access and the single transaction helper (M16).
 *
 * **A money write and its ledger posting share one transaction** (BR-18), as
 * do audit entries (M13) and job enqueues (M14). Every module reaches Prisma
 * through `client` and writes through `transaction`, so that rule holds by
 * construction:
 *
 * - `transaction(run)` opens a Prisma interactive transaction and makes it the
 *   current client for everything `run` awaits.
 * - A `transaction` call inside another **joins** it — the ledger service does
 *   not need to know whether the collection service already opened one.
 * - `client` is the open transaction when there is one, otherwise the base
 *   client. A repository that uses `client` is therefore automatically inside
 *   whatever transaction its caller opened.
 *
 * Under Tier 1 tests the base client is itself `withRollback`'s transaction,
 * and a call here joins it, so everything still rolls back.
 */
@Injectable()
export class Database {
  private readonly current = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(@Inject(PRISMA_CLIENT) private readonly base: PrismaClient) {}

  /** The open transaction if the caller is inside one, otherwise the base client. */
  get client(): Prisma.TransactionClient {
    return this.current.getStore() ?? this.base;
  }

  /** `true` inside `transaction` (or when the base client is already a transaction). */
  get inTransaction(): boolean {
    return (
      this.current.getStore() !== undefined || isTransactionClient(this.base)
    );
  }

  async transaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const open = this.current.getStore();
    if (open) return run(open);

    if (isTransactionClient(this.base)) {
      return this.current.run(this.base, () => run(this.base));
    }

    return this.base.$transaction((tx) => this.current.run(tx, () => run(tx)), {
      ...DEFAULT_TRANSACTION_OPTIONS,
      ...options,
    });
  }
}

/**
 * A Prisma 7 transaction client has no `$disconnect` — it does not own a
 * connection. (It *does* have `$transaction`, which opens a nested transaction;
 * joining instead keeps one transaction with one commit, which is the rule.)
 */
function isTransactionClient(client: PrismaClient): boolean {
  return typeof (client as Partial<PrismaClient>).$disconnect !== 'function';
}
