/**
 * The error taxonomy (M16, api-design.md#errors).
 *
 * Services throw one of these, never a bare `Error` (coding-guidelines.md).
 * The global filter turns each into `{ code, message, details, correlationId }`
 * with the category's status. `code` is stable and machine-readable —
 * `ACCOUNT_INVESTED_EXCEEDS_AMOUNT` — while `message` may be reworded freely.
 */
export interface ErrorDetail {
  /** Dotted path of the offending input, e.g. `schedule.0.amount`. */
  field: string;
  issue: string;
}

export abstract class AppError extends Error {
  abstract readonly status: number;

  constructor(
    readonly code: string,
    message: string,
    readonly details?: readonly ErrorDetail[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** `400` — malformed or invalid input. */
export class ValidationError extends AppError {
  readonly status = 400;
}

/** `401` — no valid session. */
export class AuthenticationError extends AppError {
  readonly status = 401;
}

/**
 * `403` — a valid session denied an action on a row whose existence it already
 * knows. For a row outside the caller's scope, throw `NotFoundError` (M02).
 */
export class AuthorizationError extends AppError {
  readonly status = 403;
}

/** `404` — absent, **or out of the caller's scope** (M02). */
export class NotFoundError extends AppError {
  readonly status = 404;
}

/** `409` — state conflict. Never for an idempotent replay, which succeeds (BR-13). */
export class ConflictError extends AppError {
  readonly status = 409;
}

/**
 * `422` — well-formed input the business rejects. Distinct from
 * `ValidationError` because clients present the two differently.
 */
export class DomainError extends AppError {
  readonly status = 422;
}

/** `429` — the caller has made too many attempts; try again later. */
export class RateLimitError extends AppError {
  readonly status = 429;
}

/** `500` — the client sees a generic message and the correlation id only. */
export class InternalError extends AppError {
  readonly status = 500;
}
