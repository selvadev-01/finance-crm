import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { StaffRole } from '@repo/db';
import type { NextFunction, Request, Response } from 'express';

/**
 * The authorized request context (M16, M02): who is calling and which line
 * they currently answer for. Resolved once per request by `PolicyGuard`, from
 * `staff_profile` and the current `line_assignment` — never cached, so a
 * suspension or reassignment takes effect on the next request.
 *
 * **Every repository method takes one of these as a required parameter**
 * (non-negotiable 3). Controllers obtain it with `@CurrentContext()`.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly userId: string;
  readonly staffProfileId: string;
  readonly organizationId: string;
  readonly role: StaffRole;
  /**
   * The line of the staff member's current assignment (`effectiveTo IS NULL`),
   * or `null` when they have none. Always `null`-checked by scope predicates:
   * a Senior or Junior with no current line sees nothing.
   */
  readonly currentLineId: string | null;
}

/** Where a request came from, for the audit trail (M13). */
export interface RequestClient {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** What is known about a request before and after authorization. */
interface RequestState {
  readonly requestId: string;
  readonly client: RequestClient;
  context?: RequestContext;
}

const storage = new AsyncLocalStorage<RequestState>();

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** The current request's id, or `undefined` outside a request. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * The authorized context, or `undefined` outside a request or on a route that
 * has not been through `PolicyGuard` (a public route).
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()?.context;
}

/** Called by `PolicyGuard` once the caller is resolved. */
export function setRequestContext(context: RequestContext): void {
  const state = storage.getStore();
  if (!state) {
    throw new Error('setRequestContext called outside a request');
  }
  state.context = context;
}

/** The caller's IP address and user agent, or `undefined` outside a request. */
export function getRequestClient(): RequestClient | undefined {
  return storage.getStore()?.client;
}

export function runWithRequestState<T>(
  requestId: string,
  client: RequestClient,
  run: () => T,
): T {
  return storage.run({ requestId, client }, run);
}

/**
 * Express middleware, installed first by `configureApp`. The id is always
 * generated here, never taken from the client: a client-supplied id could be
 * forged to collide with another request's log lines.
 *
 * pino-http reuses `req.id` as its request id, so logs and error bodies agree.
 */
export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = `req_${randomUUID()}`;
  (request as Request & { id: string }).id = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestState(
    requestId,
    {
      ipAddress: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    },
    next,
  );
}
