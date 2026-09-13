import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';

import { resolveError } from './error-body.js';

/**
 * The global exception filter (M16). Every error leaves the API in one shape.
 *
 * This is the boundary where errors are logged, once (coding-guidelines.md:
 * never log and rethrow). Unexpected errors are logged in full at `error`;
 * handled ones at `warn` with their code, which is enough to investigate a
 * validation failure without recording its input.
 *
 * Better Auth's `/api/auth/*` routes are served by its own handler and never
 * reach this filter; their error format is Better Auth's.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body, unexpected } = resolveError(error);
    const context = AllExceptionsFilter.name;

    if (unexpected) {
      this.logger.error(
        { err: error, code: body.code, status },
        'unhandled error',
        context,
      );
    } else {
      this.logger.warn(
        { code: body.code, status },
        'request rejected',
        context,
      );
    }

    if (response.headersSent) return;
    response.status(status).json(body);
  }
}
