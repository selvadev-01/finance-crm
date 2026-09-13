import { Controller, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { errorSchema, route } from '@repo/contracts';
import type { Server } from 'node:http';
import request from 'supertest';
import { z } from 'zod';

import {
  ContractRoute,
  Replayed,
} from '../../src/platform/contract/contract-route.js';

/**
 * The replay status (BR-13) end to end through Nest: a handler returning
 * `Replayed` answers `200` with the original body, a fresh write `201`, and a
 * route that declares no replay cannot return one. A probe app, so no row is
 * written anywhere.
 */
const body = z.object({ id: z.string() });

const replayable = route({
  method: 'POST',
  path: '/probe/replayable/:mode',
  summary: 'probe',
  pathParams: z.object({ mode: z.string() }),
  responses: { 201: body, 400: errorSchema },
  replayStatus: 200,
});

const plain = route({
  method: 'POST',
  path: '/probe/plain',
  summary: 'probe',
  responses: { 201: body },
});

@Controller()
class ProbeController {
  @ContractRoute(replayable)
  replayable() {
    return this.mode === 'replay'
      ? new Replayed({ id: 'c1', extra: 'dropped' })
      : { id: 'c1' };
  }

  mode = 'fresh';

  @ContractRoute(plain)
  plain() {
    return new Replayed({ id: 'c1' });
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('contract replay status (BR-13)', () => {
  let app: INestApplication<Server>;
  let controller: ProbeController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    controller = app.get(ProbeController);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a fresh write answers 201', async () => {
    controller.mode = 'fresh';
    await request(app.getHttpServer())
      .post('/probe/replayable/x')
      .expect(201, { id: 'c1' });
  });

  it('a replay answers 200 with the original body, still shaped by the contract', async () => {
    controller.mode = 'replay';
    await request(app.getHttpServer())
      .post('/probe/replayable/x')
      .expect(200, { id: 'c1' });
  });

  it('a route without replayStatus cannot answer a replay', async () => {
    const response = await request(app.getHttpServer()).post('/probe/plain');
    expect(response.status).toBe(500);
  });
});
