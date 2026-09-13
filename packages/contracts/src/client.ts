import type { ApiError } from "./shared.js";
import {
  type RouteDefinition,
  type RouteRequest,
  type RouteSuccess,
  successStatus,
} from "./route.js";

/**
 * A typed `fetch` client over the contract — for `apps/web`, and for the
 * offline outbox, which needs nothing more than a URL, a method and a JSON body.
 *
 * Success bodies are parsed with the route's schema, so a server that drifts
 * from the contract fails loudly at the client rather than rendering garbage.
 */
export type ApiResult<Route extends RouteDefinition> =
  | { ok: true; status: number; body: RouteSuccess<Route> }
  | { ok: false; status: number; body: ApiError | null };

export interface ApiClientOptions {
  /** Origin to prefix, or `""` for same-origin requests from the browser. */
  baseUrl: string;
  fetch?: typeof fetch;
}

export function buildPath(
  path: string,
  params: Record<string, unknown> | undefined,
): string {
  return path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing path parameter "${name}" for ${path}`);
    }
    return encodeURIComponent(String(value));
  });
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;

  return async function call<Route extends RouteDefinition>(
    definition: Route,
    request: RouteRequest<Route>,
  ): Promise<ApiResult<Route>> {
    const parts = request as {
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    const url =
      options.baseUrl +
      buildPath(definition.path, parts.params) +
      buildQuery(parts.query);

    const response = await doFetch(url, {
      method: definition.method,
      credentials: "include",
      headers:
        parts.body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body: parts.body === undefined ? undefined : JSON.stringify(parts.body),
    });

    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : null;

    const success = successStatus(definition);
    if (
      response.status === success ||
      (definition.replayStatus !== undefined &&
        response.status === definition.replayStatus)
    ) {
      const schema = definition.responses[success];
      return {
        ok: true,
        status: response.status,
        body: (schema ? schema.parse(json) : json) as RouteSuccess<Route>,
      };
    }
    return {
      ok: false,
      status: response.status,
      body: json as ApiError | null,
    };
  };
}
