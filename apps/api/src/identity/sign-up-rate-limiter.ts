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
 * A fixed-window counter per client address, in process memory.
 *
 * Public organization sign-up has no key and no email verification yet, so
 * this is what stops one address creating organizations in a loop. **It is
 * per process**: two API processes each allow the limit, and a restart resets
 * it. Acceptable for one API process (ADR-0003); a shared store is needed
 * before running several.
 *
 * Provided by `IdentityModule` through a factory; HTTP tests replace it with a
 * tighter rule.
 */
export class SignUpRateLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(private readonly rule: RateLimit = SIGN_UP_RATE_LIMIT) {}

  /** Counts an attempt; `false` once the key has used up its window. */
  tryConsume(key: string, now = Date.now()): boolean {
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.rule.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      this.sweep(now);
      return true;
    }
    window.count += 1;
    return window.count <= this.rule.limit;
  }

  /** Drops expired windows, so the map holds only recent addresses. */
  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.rule.windowMs) this.windows.delete(key);
    }
  }
}
