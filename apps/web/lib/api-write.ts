"use client";

import type {
  ApiError,
  RouteDefinition,
  RouteRequest,
  RouteSuccess,
} from "@repo/contracts";

import { api } from "./api-client";
import {
  describeWriteFailure,
  type FieldErrors,
  type FieldLabels,
} from "./api-errors";

export type WriteResult<Route extends RouteDefinition> =
  | { ok: true; body: RouteSuccess<Route> }
  | {
      ok: false;
      /** The HTTP status; `null` when Rasi could not be reached. */
      status: number | null;
      fields: FieldErrors;
      form: string | null;
      /** The API's stable code, e.g. `DUPLICATE_MOBILE`; null if unreachable. */
      code: string | null;
      /** Raw field details, for forms with nested fields. */
      details: NonNullable<ApiError["details"]>;
    };

export interface WriteOptions {
  /**
   * The fields this form shows, with their labels. Errors for them land at
   * the field; any other detail stays in `form`. Defaults to the organisation
   * dialogs' fields.
   */
  fields?: FieldLabels;
}

/** One contract write, with its failure already split for the form. */
export async function apiWrite<Route extends RouteDefinition>(
  route: Route,
  request: RouteRequest<Route>,
  options: WriteOptions = {},
): Promise<WriteResult<Route>> {
  try {
    const result = await api(route, request);
    if (result.ok) return { ok: true, body: result.body };
    return {
      ok: false,
      status: result.status,
      ...describeWriteFailure(result.status, result.body, options.fields),
      code: result.body?.code ?? null,
      details: result.body?.details ?? [],
    };
  } catch {
    return {
      ok: false,
      status: null,
      fields: {},
      form: "Could not reach Rasi. Check your connection and try again.",
      code: null,
      details: [],
    };
  }
}
