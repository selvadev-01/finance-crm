import { NestFactory } from '@nestjs/core';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // `bodyParser: false` is MANDATORY. Better Auth reads the raw request body,
  // and Nest's built-in parser consumes the stream first — which breaks every
  // /api/auth/* route with no error that points at the cause.
  //
  // Do not remove this. The auth smoke test in the e2e suite exists to fail
  // loudly if a future refactor drops it (authentication.md).
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Turning the global parser off leaves every *other* endpoint without JSON
  // body parsing, which the API design assumes it has. Re-add it for
  // everything except the auth routes.
  const jsonParser = express.json();
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.originalUrl.startsWith('/api/auth')) {
      next();
      return;
    }
    jsonParser(request, response, next);
  });

  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
