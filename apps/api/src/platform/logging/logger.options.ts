import type { Writable } from 'node:stream';

import type { Params } from 'nestjs-pino';

import type { AppConfig } from '../config/config.js';
import { redactLogLine } from './redact.js';

/**
 * Where log lines go. Standard output in the running app; tests override the
 * provider with an in-memory stream to assert on what was written.
 */
export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

/** pino-http serializes the request as `{ id, method, url, headers, … }`. */
interface SerializedRequest {
  id?: unknown;
  method?: unknown;
  url?: unknown;
}

/**
 * Structured JSON logging via pino (M16).
 *
 * - Every line written during a request carries `requestId`.
 * - Requests are logged as method, path and status only. The query string is
 *   dropped because a token can arrive in one; headers and bodies are never
 *   serialized.
 * - `redactLogLine` then applies the allowlist to the finished line.
 */
export function createLoggerParams(
  config: AppConfig,
  destination: Writable,
): Params {
  return {
    // Fields added with PinoLogger.assign — the userId, once PolicyGuard has
    // resolved the caller — also appear on the request-completed line.
    assignResponse: true,
    pinoHttp: [
      {
        level: config.LOG_LEVEL,
        // Set by requestContextMiddleware, so logs and correlation ids agree.
        genReqId: (request) => String((request as { id?: unknown }).id),
        quietReqLogger: true,
        customAttributeKeys: { reqId: 'requestId' },
        serializers: {
          req: (request: SerializedRequest) => ({
            id: request.id,
            method: request.method,
            url: String(request.url ?? '').split('?')[0],
          }),
          res: (response: { statusCode?: unknown }) => ({
            statusCode: response.statusCode,
          }),
        },
        hooks: { streamWrite: redactLogLine },
      },
      destination,
    ],
  };
}
