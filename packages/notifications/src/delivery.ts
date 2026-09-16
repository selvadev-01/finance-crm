import type { PushPayload, PushProvider, PushResult, PushTarget } from "./types.js";

/**
 * notifications.md#delivery-and-retry — attempt 1 immediately, then 1 min,
 * 5 min, 30 min and 2 hours; after the fifth, FAILED.
 */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * What to do with an outbox row after an attempt. `attempts` counts the one
 * just made. Routing is by the subscription's own provider, so a stored
 * subscription always goes to the provider that created it (BOTH mode, or
 * after the configuration changes).
 */
export type Outcome =
  | { status: "SENT" }
  | { status: "PENDING"; nextAttemptAt: Date; lastError: string }
  | { status: "FAILED"; lastError: string; deactivate: boolean };

export function outcome(result: PushResult, attempts: number, now: Date): Outcome {
  switch (result.status) {
    case "sent":
      return { status: "SENT" };
    case "gone":
      return { status: "FAILED", lastError: `gone: ${result.reason}`, deactivate: true };
    case "failed":
      return { status: "FAILED", lastError: result.reason, deactivate: false };
    case "retry": {
      if (attempts >= MAX_ATTEMPTS) {
        // A subscription that fails every retry budget is dead in practice.
        return { status: "FAILED", lastError: `gave up after ${attempts}: ${result.reason}`, deactivate: true };
      }
      const delay = RETRY_DELAYS_MS[attempts - 1]!;
      return { status: "PENDING", nextAttemptAt: new Date(now.getTime() + delay), lastError: result.reason };
    }
  }
}

/** Sends through the provider matching the target, or reports none configured. */
export async function deliver(
  providers: readonly PushProvider[],
  target: PushTarget,
  payload: PushPayload,
): Promise<PushResult> {
  const provider = providers.find((candidate) => candidate.name === target.provider);
  if (!provider) return { status: "retry", reason: `${target.provider} is not configured` };
  return provider.send(target, payload);
}
