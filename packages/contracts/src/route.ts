import type { z } from "zod";

/**
 * A route in the API contract (ADR-0011, superseding the ts-rest choice in
 * ADR-0002).
 *
 * One object per endpoint: method, path, and the Zod schema for each part of
 * the request and for each response status. `apps/api` validates requests and
 * shapes responses against it; `apps/web` calls it through `createApiClient`.
 * Nothing is generated, so the two sides cannot drift — a changed schema is a
 * type error on both.
 *
 * Paths are the full public path (`/api/sectors/:sectorId`) and use
 * `:param` segments, which Express and the client both understand. The result
 * is ordinary REST that the offline outbox can store and replay with `fetch`.
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  summary: string;
  pathParams?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Keyed by HTTP status. Exactly one 2xx status — the one the handler returns. */
  responses: Record<number, z.ZodType>;
  /**
   * An idempotent write (BR-13) answers a replayed key with this status and
   * the **same body schema** as its success status: `201` when it created the
   * record, `200` when it had already. The client treats both as success.
   */
  replayStatus?: 200;
  /**
   * The success response is a file download (an export, M12), not JSON: its
   * schema is {@link fileBodySchema} and is never parsed. Errors are still the
   * JSON `errorSchema` body. Call it with `downloadFile`, not `createApiClient`.
   */
  file?: true;
}

/** Declares a route, keeping its literal types for both server and client. */
export function route<const Route extends RouteDefinition>(
  definition: Route,
): Route {
  const successes = Object.keys(definition.responses)
    .map(Number)
    .filter((status) => status >= 200 && status < 300);
  if (successes.length !== 1) {
    throw new Error(
      `${definition.method} ${definition.path} must declare exactly one 2xx response, found ${successes.length}`,
    );
  }
  return definition;
}

/** The single 2xx status a route responds with. */
export function successStatus(definition: RouteDefinition): number {
  const status = Object.keys(definition.responses)
    .map(Number)
    .find((code) => code >= 200 && code < 300);
  if (status === undefined) {
    throw new Error(
      `${definition.method} ${definition.path} has no 2xx response`,
    );
  }
  return status;
}

type Infer<Schema> = Schema extends z.ZodType ? z.infer<Schema> : undefined;

/** What a handler receives after validation, with defaults applied. */
export interface RouteInput<Route extends RouteDefinition> {
  params: Infer<Route["pathParams"]>;
  query: Infer<Route["query"]>;
  body: Infer<Route["body"]>;
}

/** What a client sends: only the parts the route declares, before defaults. */
export type RouteRequest<Route extends RouteDefinition> =
  (Route["pathParams"] extends z.ZodType
    ? { params: z.input<Route["pathParams"]> }
    : unknown) &
    (Route["query"] extends z.ZodType
      ? { query?: z.input<Route["query"]> }
      : unknown) &
    (Route["body"] extends z.ZodType
      ? { body: z.input<Route["body"]> }
      : unknown);

type SuccessKey<Responses> = {
  [Status in keyof Responses]: Status extends 200 | 201 | 202 | 204
    ? Status
    : never;
}[keyof Responses];

/** The body a handler returns and a client receives on success. */
export type RouteSuccess<Route extends RouteDefinition> = z.infer<
  Route["responses"][SuccessKey<Route["responses"]> & number]
>;
