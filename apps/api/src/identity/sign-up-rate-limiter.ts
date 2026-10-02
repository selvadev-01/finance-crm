import { Database } from '../platform/database/database.js';

export interface RateLimit {
  /** Attempts allowed per key within one window. */
  readonly limit: number;
  readonly windowMs: number;
}

/** ADR-0012: five sign-up attempts an hour from one address. */
export const SIGN_UP_RATE_LIMIT: RateLimit = {
  limit: 5,
  windowMs: 60 * 60 * 1000,
};

/**
 * A fixed-window counter per client address (ADR-0012). Public organization
 * sign-up has no key and no email verification yet, so this is what stops one
 * address creating organizations in a loop.
 *
 * The token `OrganizationSignUpService` depends on. Production provides
 * {@link PostgresSignUpRateLimiter}, shared by every API process and kept
 * across restarts; HTTP tests get {@link MemorySignUpRateLimiter} from
 * `createTestApp`, so no test run spends a real address's window.
 */
export abstract class SignUpRateLimiter {
  /** Counts an attempt; `false` once the key has used up its window. */
  abstract tryConsume(key: string, now?: Date): Promise<boolean>;
}

/** Per process, forgotten on restart — for tests only. */
export class MemorySignUpRateLimiter extends SignUpRateLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(private readonly rule: RateLimit = SIGN_UP_RATE_LIMIT) {
    super();
  }

  tryConsume(key: string, now = new Date()): Promise<boolean> {
    const at = now.getTime();
    const window = this.windows.get(key);
    if (!window || at - window.start >= this.rule.windowMs) {
      this.windows.set(key, { start: at, count: 1 });
      this.sweep(at);
      return Promise.resolve(true);
    }
    window.count += 1;
    return Promise.resolve(window.count <= this.rule.limit);
  }

  /** Drops expired windows, so the map holds only recent addresses. */
  private sweep(at: number): void {
    for (const [key, window] of this.windows) {
      if (at - window.start >= this.rule.windowMs) this.windows.delete(key);
    }
  }
}

/**
 * The counter in `rate_limit_window`, one row per key. A single upsert opens a
 * new window or counts into the current one, so concurrent attempts from any
 * number of API processes are serialised on the row and none is lost
 * (ADR-0012's "a shared counter before more than one process"). Expired
 * windows for this limiter are deleted as it runs.
 *
 * It runs in its own transaction, before the sign-up's: a refused or failed
 * sign-up still used its attempt.
 */
export class PostgresSignUpRateLimiter extends SignUpRateLimiter {
  constructor(
    private readonly database: Database,
    private readonly rule: RateLimit = SIGN_UP_RATE_LIMIT,
    private readonly prefix = 'sign-up:',
  ) {
    super();
  }

  tryConsume(key: string, now = new Date()): Promise<boolean> {
    const expired = new Date(now.getTime() - this.rule.windowMs);
    const id = `${this.prefix}${key}`;
    return this.database.transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM rate_limit_window
        WHERE key LIKE ${`${this.prefix}%`} AND "windowStart" <= ${expired}`;
      const [row] = await tx.$queryRaw<[{ count: number }]>`
        INSERT INTO rate_limit_window (key, "windowStart", count)
        VALUES (${id}, ${now}, 1)
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN rate_limit_window."windowStart" <= ${expired}
                       THEN 1 ELSE rate_limit_window.count + 1 END,
          "windowStart" = CASE WHEN rate_limit_window."windowStart" <= ${expired}
                               THEN ${now} ELSE rate_limit_window."windowStart" END
        RETURNING count`;
      return Number(row.count) <= this.rule.limit;
    });
  }
}
