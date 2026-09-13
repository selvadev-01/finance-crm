import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@repo/db';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { createTestPrismaClient, truncateTestSchema } from './database.js';

/**
 * The auth smoke test.
 *
 * This exists as a standing regression guard for two settings that fail
 * silently and confusingly when a refactor drops them (authentication.md):
 *
 *   - `bodyParser: false` on the Nest application. Better Auth reads the raw
 *     request body; Nest's parser consumes the stream first, and every auth
 *     route then breaks with nothing pointing at the cause.
 *   - `AuthModule.forRoot({ auth })` with the object argument. The positional
 *     `forRoot(auth)` form is deprecated and does not mount the routes.
 *
 * If either regresses, sign-up stops returning a session cookie and this test
 * fails — which is the whole point of it existing this early.
 */
describe('authentication (e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;

  const credentials = {
    name: 'Harness User',
    email: 'harness@rasi.test',
    password: 'a-sufficiently-long-password',
  };

  beforeAll(async () => {
    prisma = createTestPrismaClient();
  });

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Mirrors main.ts exactly. If these two lines drift apart, the test stops
    // guarding what it claims to guard.
    app = moduleFixture.createNestApplication({ bodyParser: false });

    const jsonParser = express.json();
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.originalUrl.startsWith('/api/auth')) {
        next();
        return;
      }
      jsonParser(req, res, next);
    });

    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await truncateTestSchema(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('signs a new user up and returns a session cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send(credentials)
      .expect(200);

    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(String(cookies)).toContain('better-auth.session_token');
    // 30-day rolling session, deliberately long because a Junior may be
    // offline for weeks (authentication.md).
    expect(String(cookies)).toContain('Max-Age=2592000');
    expect(String(cookies)).toContain('HttpOnly');
  });

  it('signs an existing user in and resolves their session', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send(credentials)
      .expect(200);

    const signIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    const cookie = signIn.headers['set-cookie'];
    expect(cookie).toBeDefined();

    const session = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set('Cookie', cookie as unknown as string[])
      .expect(200);

    expect(session.body?.user?.email).toBe(credentials.email);
  });

  it('rejects a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send(credentials)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: credentials.email, password: 'not-the-password' })
      .expect(401);
  });

  it('writes to the test schema and truncation clears it', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send(credentials)
      .expect(200);

    expect(await prisma.user.count()).toBe(1);

    await truncateTestSchema(prisma);

    expect(await prisma.user.count()).toBe(0);
  });
});
