import type { INestApplication } from '@nestjs/common';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';

import { requestContextMiddleware } from './context/request-context.js';
import { resolveError } from './errors/error-body.js';
import { ValidationError } from './errors/errors.js';

/**
 * Everything applied to the Nest application outside the module graph.
 *
 * `main.ts` and every HTTP test call this one function, so a test cannot
 * silently exercise a differently configured app than production runs.
 */
export function configureApp(app: INestApplication): void {
  // First, so every later middleware, handler and log line has a request id.
  app.use(requestContextMiddleware);
  app.use(jsonBodyExceptAuth());
  app.useLogger(app.get(Logger));
}

/**
 * The application is created with `bodyParser: false`, which is MANDATORY:
 * Better Auth reads the raw request body, and Nest's built-in parser consumes
 * the stream first — breaking every /api/auth/* route with no error that
 * points at the cause. The auth smoke test fails loudly if it is dropped
 * (authentication.md).
 *
 * That leaves every other endpoint without JSON parsing, so it is re-added
 * here for everything except the auth routes. Parser failures happen before
 * Nest's exception filter exists in the pipeline, so they are answered here in
 * the same error shape.
 */
function jsonBodyExceptAuth() {
  const jsonParser = express.json();

  return (request: Request, response: Response, next: NextFunction) => {
    if (request.originalUrl.startsWith('/api/auth')) {
      next();
      return;
    }
    jsonParser(request, response, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      const type = (error as { type?: unknown }).type;
      const rejection =
        type === 'entity.parse.failed'
          ? new ValidationError(
              'MALFORMED_JSON',
              'The request body is not valid JSON',
            )
          : new ValidationError(
              'INVALID_REQUEST_BODY',
              'The request body could not be read',
            );
      const { status, body } = resolveError(rejection);
      response.status(status).json(body);
    });
  };
}
