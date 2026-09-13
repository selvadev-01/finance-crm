import { HttpException } from '@nestjs/common';
import { ZodError } from 'zod';

import { getRequestId } from '../context/request-context.js';
import { AppError, type ErrorDetail } from './errors.js';

/** The one error shape (api-design.md#errors). */
export interface ErrorBody {
  code: string;
  message: string;
  details?: readonly ErrorDetail[];
  correlationId: string;
}

export interface ResolvedError {
  status: number;
  body: ErrorBody;
  /** `true` when the error was unexpected and must be logged in full. */
  unexpected: boolean;
}

const INTERNAL_MESSAGE =
  'An unexpected error occurred. Quote the correlation id when reporting it.';

/** Codes for Nest's own exceptions — a missing route, the auth guard's 401. */
const HTTP_STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Maps anything thrown to a status and body.
 *
 * Only `AppError`, `ZodError` and a 4xx `HttpException` reveal their message.
 * Everything else — a Prisma error, a `TypeError`, a 5xx — gets a generic
 * message, because database messages and stack traces must never reach the
 * client (M16). The correlation id ties the response to the full log line.
 */
export function resolveError(error: unknown): ResolvedError {
  const correlationId = getRequestId() ?? 'unavailable';

  if (error instanceof AppError && error.status < 500) {
    return {
      status: error.status,
      unexpected: false,
      body: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        correlationId,
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      unexpected: false,
      body: {
        code: 'VALIDATION_FAILED',
        message: 'The request is invalid',
        details: error.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          issue: issue.message,
        })),
        correlationId,
      },
    };
  }

  if (error instanceof HttpException && error.getStatus() < 500) {
    const status = error.getStatus();
    return {
      status,
      unexpected: false,
      body: {
        code: HTTP_STATUS_CODES[status] ?? 'BAD_REQUEST',
        message: messageOf(error),
        correlationId,
      },
    };
  }

  return {
    status: 500,
    unexpected: true,
    body: {
      code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
      message: INTERNAL_MESSAGE,
      correlationId,
    },
  };
}

function messageOf(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return error.message;
}
