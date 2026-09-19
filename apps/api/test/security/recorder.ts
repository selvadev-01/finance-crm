import type { PrismaClient } from '@repo/db';
import type { PinoLogger } from 'nestjs-pino';

import type { RequestRoute } from '../../src/platform/context/request-context.js';
import {
  SecurityEventRecorder,
  type SecurityEventRow,
} from '../../src/security/security-event.recorder.js';

/** The route a Tier 1 test stands in for, since no request matched one. */
export const TEST_ROUTE: RequestRoute = {
  method: 'POST',
  path: '/api/staff/:staffProfileId/role',
};

/** Log lines a recorder produced, so a test can assert it stayed quiet — or did not. */
export interface RecorderLog {
  warned: { fields: unknown; message: string }[];
  errored: { fields: unknown; message: string }[];
}

export function recorderLog(): RecorderLog & PinoLogger {
  const log: RecorderLog = { warned: [], errored: [] };
  return Object.assign(log, {
    warn: (fields: unknown, message: string) =>
      log.warned.push({ fields, message }),
    error: (fields: unknown, message: string) =>
      log.errored.push({ fields, message }),
  }) as unknown as RecorderLog & PinoLogger;
}

/**
 * A real `SecurityEventRecorder` writing real rows into the test's rolled-back
 * transaction. Only the route lookup is stood in for: Tier 1 calls services
 * directly, so no request has matched a route.
 */
class Tier1Recorder extends SecurityEventRecorder {
  constructor(
    client: PrismaClient,
    logger: PinoLogger,
    private readonly stubRoute: RequestRoute | undefined,
  ) {
    super(client, logger);
  }

  protected override route(): RequestRoute | undefined {
    return this.stubRoute;
  }
}

export function testRecorder(
  tx: PrismaClient,
  options: { logger?: PinoLogger; route?: RequestRoute | null } = {},
): SecurityEventRecorder {
  return new Tier1Recorder(
    tx,
    options.logger ?? recorderLog(),
    options.route === null ? undefined : (options.route ?? TEST_ROUTE),
  );
}

/** A recorder whose insert always fails, to prove the refusal still gets out. */
export function failingRecorder(
  tx: PrismaClient,
  logger: PinoLogger,
): SecurityEventRecorder {
  class Broken extends Tier1Recorder {
    protected override write(_row: SecurityEventRow): Promise<void> {
      return Promise.reject(new Error('security_event insert failed'));
    }
  }
  return new Broken(tx, logger, TEST_ROUTE);
}
