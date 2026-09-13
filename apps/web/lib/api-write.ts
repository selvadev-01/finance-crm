"use client";

import type {
  ApiError,
  RouteDefinition,
  RouteRequest,
  RouteSuccess,
} from "@repo/contracts";

import { api } from "./api-client";
import { describeWriteFailure, type FieldErrors } from "./api-errors";

export type WriteResult<Route extends RouteDefinition> =
  | { ok: true; body: RouteSuccess<Route> }
  | {
      ok: false;
      fields: FieldErrors;
      form: string | null;
      /** The API's stable code, e.g. `DUPLICATE_MOBILE`; null if unreachable. */
      code: string | null;
      /** Raw field details, for forms with nested fields. */
      details: NonNullable<ApiError["details"]>;
    };

/** One contract write, with its failure already split for the form. */
export async function apiWrite<Route extends RouteDefinition>(
  route: Route,
  request: RouteRequest<Route>,
): Promise<WriteResult<Route>> {
  try {
    const result = await api(route, request);
    if (result.ok) return { ok: true, body: result.body };
    return {
      ok: false,
      ...describeWriteFailure(result.status, result.body),
      code: result.body?.code ?? null,
      details: result.body?.details ?? [],
    };
  } catch {
    return {
      ok: false,
      fields: {},
      form: "Could not reach Rasi. Check your connection and try again.",
      code: null,
      details: [],
    };
  }
}
