import type { INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { Writable } from 'node:stream';

import { getPrismaClient } from '@repo/db';

import { AppModule } from '../src/app.module.js';
import { passwordChange } from '../src/auth/password-change.js';
import { type AuditRow, AuditWriter } from '../src/audit/audit.writer.js';
import { type SignInAttempt, signInAudit } from '../src/auth/sign-in-audit.js';
import {
  APP_CONFIG,
  type AppConfig,
  loadConfig,
} from '../src/platform/config/config.js';
import { configureApp } from '../src/platform/configure-app.js';
import { LOG_DESTINATION } from '../src/platform/logging/logger.options.js';

export interface TestAppOptions {
  /** Extra controllers mounted beside the real ones — probes for platform behaviour. */
  controllers?: Type[];
  /** Replaces standard output as the log destination. */
  logDestination?: Writable;
  /** Overrides individual configuration values. */
  config?: Partial<AppConfig>;
  /** Extra providers the probe controllers depend on. */
  providers?: Provider[];
  /** Replaces providers by token — e.g. a failing database client. */
  overrides?: readonly (readonly [token: unknown, value: unknown])[];
}

/**
 * Sign-in attempts recorded by HTTP tests, in order.
 *
 * `audit_log` rejects DELETE (M13), so a real `LOGIN` row written by an HTTP
 * test would stay in the shared development schema for ever. `createTestApp`
 * therefore routes sign-in audit writes here; `test/auth/sign-in-audit.spec.ts`
 * proves the real write inside a rolled-back transaction.
 */
export const recordedSignIns: SignInAttempt[] = [];

/** Audit entries written by HTTP tests, for the same reason. */
export const recordedAudit: AuditRow[] = [];

/** Users whose forced password change completed during HTTP tests. */
export const recordedPasswordChanges: string[] = [];

/**
 * The real `AuditWriter` — including its refusal to write outside a
 * transaction — with only the final insert redirected to `recordedAudit`.
 */
class RecordingAuditWriter extends AuditWriter {
  protected override write(row: AuditRow): Promise<void> {
    recordedAudit.push(row);
    return Promise.resolve();
  }
}

/**
 * The application exactly as `main.ts` builds it — `bodyParser: false` and
 * `configureApp` — so an HTTP test cannot pass against a differently
 * configured app than production runs. The one difference is the sign-in
 * audit destination, above.
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<INestApplication<Server>> {
  signInAudit.write = async (attempt) => {
    recordedSignIns.push(attempt);
  };
  // Clears the flag for real — only the audit row is left out.
  passwordChange.complete = async (userId) => {
    await getPrismaClient().staffProfile.updateMany({
      where: { userId, mustChangePassword: true },
      data: { mustChangePassword: false },
    });
    recordedPasswordChanges.push(userId);
  };

  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  })
    .overrideProvider(AuditWriter)
    .useClass(RecordingAuditWriter);
  if (options.logDestination) {
    builder = builder
      .overrideProvider(LOG_DESTINATION)
      .useValue(options.logDestination);
  }
  if (options.config) {
    builder = builder
      .overrideProvider(APP_CONFIG)
      .useValue(Object.freeze({ ...loadConfig(), ...options.config }));
  }

  for (const [token, value] of options.overrides ?? []) {
    builder = builder.overrideProvider(token).useValue(value);
  }

  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication<INestApplication<Server>>({
    bodyParser: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

/** An in-memory log destination. `lines()` parses what has been written. */
export function captureLogs(): Writable & {
  text: () => string;
  lines: () => Record<string, unknown>[];
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return Object.assign(stream, {
    text: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  });
}
