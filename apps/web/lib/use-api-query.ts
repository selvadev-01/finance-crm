"use client";

import type {
  RouteDefinition,
  RouteRequest,
  RouteSuccess,
} from "@repo/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api } from "./api-client";

/**
 * What a screen can be showing for one read. `not-found` covers out of scope
 * too: the API answers both with the same `404` (M02), so the screen cannot —
 * and must not try to — tell them apart.
 */
export type QueryState<Route extends RouteDefinition> =
  | { status: "loading" }
  | { status: "ready"; data: RouteSuccess<Route> }
  | { status: "not-found" }
  | { status: "not-permitted" }
  | { status: "error"; message: string };

interface Settled<Route extends RouteDefinition> {
  key: string;
  state: QueryState<Route>;
}

/**
 * One contract read from the browser, re-run when its request changes or on
 * `reload()`. A lost session goes to sign-in and a pending forced password
 * change to its screen — the same answers `useMe` follows.
 *
 * Pass `null` to skip the read until something it depends on is known.
 */
export function useApiQuery<Route extends RouteDefinition>(
  route: Route,
  request: RouteRequest<Route> | null,
): QueryState<Route> & { reload: () => void } {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<Route> | null>(null);
  const key = request === null ? null : `${JSON.stringify(request)}#${version}`;

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const body = JSON.parse(key.slice(0, key.lastIndexOf("#"))) as RouteRequest<Route>;

    const settle = (state: QueryState<Route>) => {
      if (!cancelled) setSettled({ key, state });
    };

    api(route, body)
      .then((result) => {
        if (result.ok) return settle({ status: "ready", data: result.body });
        if (result.status === 401) return router.replace("/sign-in");
        if (result.body?.code === "PASSWORD_CHANGE_REQUIRED") {
          return router.replace("/change-password");
        }
        if (result.status === 404) return settle({ status: "not-found" });
        if (result.status === 403) return settle({ status: "not-permitted" });
        settle({
          status: "error",
          message: "This couldn’t be loaded just now. Try again in a moment.",
        });
      })
      .catch(() =>
        settle({
          status: "error",
          message: "Could not reach Rasi. Check your connection and try again.",
        }),
      );

    return () => {
      cancelled = true;
    };
  }, [key, route, router]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  // A stale answer for an earlier request is never shown as the current one.
  const state: QueryState<Route> =
    settled && settled.key === key ? settled.state : { status: "loading" };
  return { ...state, reload };
}
