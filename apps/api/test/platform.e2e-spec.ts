import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Param,
  Post,
} from '@nestjs/common';
import { toBusinessDate } from '@repo/domain';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { PinoLogger } from 'nestjs-pino';
import type { Server } from 'node:http';
import request from 'supertest';
import { z } from 'zod';

import { RequirePermission } from '../src/access/decorators.js';
import { auth } from '../src/auth/auth.config.js';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DomainError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../src/platform/errors/errors.js';
import { captureLogs, createTestApp } from './app.js';

const SECRETS = {
  password: 'probe-password-7f3a',
  cookie: 'probe-session-token-9c21',
  bearer: 'probe-bearer-token-4d88',
  query: 'probe-query-token-b612',
  p256dh: 'probe-p256dh-key-e0f5',
  pushAuth: 'probe-push-auth-a7c3',
};

/** Throws each category, and logs a payload full of secrets — mounted only in tests. */
@Controller('__probe')
class PlatformProbeController {
  constructor(private readonly logger: PinoLogger) {}

  @AllowAnonymous()
  @Get('error/:kind')
  throwError(@Param('kind') kind: string): never {
    const details = [
      { field: 'investedAmount', issue: 'must be less than accountAmount' },
    ];
    switch (kind) {
      case 'validation':
        throw new ValidationError(
          'PROBE_INVALID',
          'Probe input is invalid',
          details,
        );
      case 'authentication':
        throw new AuthenticationError('PROBE_UNAUTHENTICATED', 'No session');
      case 'authorization':
        throw new AuthorizationError('PROBE_FORBIDDEN', 'Not allowed');
      case 'not-found':
        throw new NotFoundError('PROBE_NOT_FOUND', 'No such row');
      case 'conflict':
        throw new ConflictError('PROBE_CONFLICT', 'State conflict');
      case 'domain':
        throw new DomainError(
          'ACCOUNT_INVESTED_EXCEEDS_AMOUNT',
          'Invested amount must be below the account amount',
          details,
        );
      case 'internal':
        throw new InternalError(
          'LEDGER_UNBALANCED',
          'debits 100.00 != credits 99.99',
        );
      case 'zod':
        z.object({
          amount: z.string(),
          schedule: z.array(z.object({ sequence: z.number() })),
        }).parse({ amount: 100, schedule: [{ sequence: 'one' }] });
        throw new Error('unreachable');
      default:
        throw new Error(
          'relation "account_loan" does not exist at /srv/rasi/secret-path.ts:42',
        );
    }
  }

  @RequirePermission('customer.view')
  @Get('protected')
  protectedRoute() {
    return { ok: true };
  }

  @AllowAnonymous()
  @Post('log')
  log(@Body() body: Record<string, unknown>) {
    this.logger.info(
      {
        password: body['password'],
        subscription: body['subscription'],
        amount: '100.00',
        collectionId: 'col_probe',
      },
      'probe payload',
    );
    return { ok: true };
  }
}

describe('platform (e2e)', () => {
  let app: INestApplication<Server>;
  let logs: ReturnType<typeof captureLogs>;

  // One app for the whole file. nestjs-pino holds its root logger statically,
  // so a second app in the same process keeps writing to the first app's
  // destination; tests instead isolate their log lines by request id.
  beforeAll(async () => {
    logs = captureLogs();
    app = await createTestApp({
      controllers: [PlatformProbeController],
      logDestination: logs,
      config: { LOG_LEVEL: 'info' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /** pino-http logs a request on `finish`, which can land after supertest resolves. */
  const flushLogs = () => new Promise((resolve) => setImmediate(resolve));

  const linesFor = (requestId: unknown) =>
    logs.lines().filter((line) => line['requestId'] === requestId);

  describe('health checks', () => {
    it('/health/live answers without a session and without resolving one', async () => {
      const getSession = vi.spyOn(auth.api, 'getSession');
      try {
        await request(app.getHttpServer())
          .get('/health/live')
          .expect(200, { status: 'ok' });
        expect(getSession).not.toHaveBeenCalled();
      } finally {
        getSession.mockRestore();
      }
    });

    it('/health/ready reports the database reachable and every migration applied', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);
      expect(response.body).toEqual({
        status: 'ok',
        checks: {
          database: { status: 'ok' },
          migrations: { status: 'ok', pending: 0, failed: 0 },
        },
      });
    });

    it('/health/info reports version, server clock and timezone, and the business date', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/info')
        .expect(200);
      expect(response.body).toMatchObject({
        version: expect.any(String),
        serverTimeZone: expect.any(String),
        serverUtcOffsetMinutes: expect.any(Number),
        businessTimeZone: 'Asia/Kolkata',
      });
      const serverTime = new Date(response.body.serverTime as string);
      expect(Math.abs(serverTime.getTime() - Date.now())).toBeLessThan(5_000);
      expect(response.body.businessDate).toBe(toBusinessDate(serverTime));
    });
  });

  describe('error taxonomy', () => {
    it.each([
      ['validation', 400, 'PROBE_INVALID'],
      ['authentication', 401, 'PROBE_UNAUTHENTICATED'],
      ['authorization', 403, 'PROBE_FORBIDDEN'],
      ['not-found', 404, 'PROBE_NOT_FOUND'],
      ['conflict', 409, 'PROBE_CONFLICT'],
      ['domain', 422, 'ACCOUNT_INVESTED_EXCEEDS_AMOUNT'],
    ])(
      'a %s error is %i with code %s, its message and a correlation id',
      async (kind, status, code) => {
        const response = await request(app.getHttpServer())
          .get(`/__probe/error/${kind}`)
          .expect(status);
        expect(response.body).toMatchObject({
          code,
          message: expect.any(String),
        });
        expect(response.body.correlationId).toBe(
          response.headers['x-request-id'],
        );
        expect(response.body.correlationId).toMatch(/^req_[0-9a-f-]{36}$/);
      },
    );

    it('a domain error carries field-level detail, distinct from a 400', async () => {
      const response = await request(app.getHttpServer())
        .get('/__probe/error/domain')
        .expect(422);
      expect(response.body).toEqual({
        code: 'ACCOUNT_INVESTED_EXCEEDS_AMOUNT',
        message: 'Invested amount must be below the account amount',
        details: [
          { field: 'investedAmount', issue: 'must be less than accountAmount' },
        ],
        correlationId: response.headers['x-request-id'],
      });
    });

    it('a Zod failure is a 400 with a detail per field path', async () => {
      const response = await request(app.getHttpServer())
        .get('/__probe/error/zod')
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(
        response.body.details.map((d: { field: string }) => d.field),
      ).toEqual(['amount', 'schedule.0.sequence']);
    });

    it('an unexpected error is a 500 with a generic message — no stack, path or database text', async () => {
      const response = await request(app.getHttpServer())
        .get('/__probe/error/unexpected')
        .expect(500);
      expect(response.body).toEqual({
        code: 'INTERNAL_ERROR',
        message: expect.stringMatching(/unexpected error/),
        correlationId: response.headers['x-request-id'],
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /account_loan|secret-path|at \//,
      );
    });

    it('an unexpected error is logged in full under the same correlation id', async () => {
      const response = await request(app.getHttpServer())
        .get('/__probe/error/unexpected')
        .expect(500);
      await flushLogs();
      const logged = linesFor(response.body.correlationId).find(
        (line) => line['msg'] === 'unhandled error',
      );
      expect(logged).toBeDefined();
      expect(JSON.stringify(logged?.['err'])).toContain('account_loan');
    });

    it('an InternalError keeps its code but never its message', async () => {
      const response = await request(app.getHttpServer())
        .get('/__probe/error/internal')
        .expect(500);
      expect(response.body.code).toBe('LEDGER_UNBALANCED');
      expect(JSON.stringify(response.body)).not.toContain('99.99');
    });

    it('a route that needs a session answers 401 in the standard shape', async () => {
      const response = await request(app.getHttpServer())
        .get('/__probe/protected')
        .expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(response.body.correlationId).toBe(
        response.headers['x-request-id'],
      );
    });

    it('an unknown route is a 404 in the standard shape', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/nope')
        .expect(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('a malformed JSON body is a 400 in the standard shape', async () => {
      const response = await request(app.getHttpServer())
        .post('/__probe/log')
        .set('Content-Type', 'application/json')
        .send('{"password": ')
        .expect(400);
      expect(response.body).toMatchObject({
        code: 'MALFORMED_JSON',
        correlationId: response.headers['x-request-id'],
      });
    });
  });

  describe('logging', () => {
    it('never writes a password, cookie, bearer token, query token or push subscription key', async () => {
      const response = await request(app.getHttpServer())
        .post(`/__probe/log?token=${SECRETS.query}`)
        .set('Cookie', `better-auth.session_token=${SECRETS.cookie}`)
        .set('Authorization', `Bearer ${SECRETS.bearer}`)
        .send({
          password: SECRETS.password,
          subscription: {
            endpoint: 'https://push.example',
            keys: { p256dh: SECRETS.p256dh, auth: SECRETS.pushAuth },
          },
        })
        .expect(201);
      await flushLogs();

      expect(
        linesFor(response.headers['x-request-id']).some(
          (line) => line['msg'] === 'probe payload',
        ),
      ).toBe(true);
      // Everything this app has ever logged, not just this request's lines.
      const output = logs.text();
      for (const secret of Object.values(SECRETS)) {
        expect(output).not.toContain(secret);
      }
    });

    it('keeps allowlisted fields, with money as a string, and tags every line with the request id', async () => {
      const response = await request(app.getHttpServer())
        .post('/__probe/log')
        .send({ password: SECRETS.password })
        .expect(201);
      await flushLogs();

      const lines = linesFor(response.headers['x-request-id']);
      const probe = lines.find((line) => line['msg'] === 'probe payload');
      expect(probe).toMatchObject({
        amount: '100.00',
        collectionId: 'col_probe',
        password: '[REDACTED]',
      });

      const completed = lines.find((line) => line['res'] !== undefined);
      expect(completed).toMatchObject({
        req: { method: 'POST', url: '/__probe/log' },
        res: { statusCode: 201 },
      });
    });

    it('logs the path without its query string', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/live?token=abc')
        .expect(200);
      await flushLogs();
      const completed = linesFor(response.headers['x-request-id']).find(
        (line) => line['res'] !== undefined,
      );
      expect(completed?.['req']).toMatchObject({ url: '/health/live' });
    });

    it('each request gets its own id', async () => {
      const first = await request(app.getHttpServer()).get('/health/live');
      const second = await request(app.getHttpServer()).get('/health/live');
      expect(first.headers['x-request-id']).not.toBe(
        second.headers['x-request-id'],
      );
    });
  });
});
