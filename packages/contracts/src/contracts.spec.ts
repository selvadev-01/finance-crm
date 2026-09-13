import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildPath, createApiClient } from "./client.js";
import { organisationContract } from "./organisation.contract.js";
import { route, successStatus } from "./route.js";
import { calendarDateSchema, codeSchema, pageQuerySchema } from "./shared.js";

describe("route()", () => {
  it("refuses a route without exactly one success status", () => {
    expect(() =>
      route({
        method: "GET",
        path: "/api/x",
        summary: "x",
        responses: { 404: z.object({}) },
      }),
    ).toThrow(/exactly one 2xx/);
    expect(() =>
      route({
        method: "GET",
        path: "/api/x",
        summary: "x",
        responses: { 200: z.object({}), 201: z.object({}) },
      }),
    ).toThrow(/exactly one 2xx/);
  });

  it("every organisation route declares one success status", () => {
    for (const definition of Object.values(organisationContract)) {
      expect(successStatus(definition)).toBeGreaterThanOrEqual(200);
    }
  });

  it("every organisation route path is unique per method", () => {
    const keys = Object.values(organisationContract).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("shared schemas", () => {
  it.each(["2026-09-13", "2028-02-29"])(
    "accepts the calendar date %s",
    (value) => {
      expect(calendarDateSchema.parse(value)).toBe(value);
    },
  );

  it.each(["2026-02-29", "13-09-2026", "2026-09-13T00:00:00Z", ""])(
    "rejects %j as a calendar date",
    (value) => {
      expect(calendarDateSchema.safeParse(value).success).toBe(false);
    },
  );

  it("trims codes and rejects spaces inside them", () => {
    expect(codeSchema.parse("  LN-07 ")).toBe("LN-07");
    expect(codeSchema.safeParse("LN 07").success).toBe(false);
  });

  it("defaults the page size to 50 and caps it at 200", () => {
    expect(pageQuerySchema.parse({}).limit).toBe(50);
    expect(pageQuerySchema.parse({ limit: "200" }).limit).toBe(200);
    expect(pageQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });
});

describe("createApiClient", () => {
  it("fills path parameters, encodes them, and refuses a missing one", () => {
    expect(
      buildPath("/api/lines/:lineId/deactivation", { lineId: "a/b" }),
    ).toBe("/api/lines/a%2Fb/deactivation");
    expect(() => buildPath("/api/lines/:lineId", {})).toThrow(/lineId/);
  });

  it("sends method, JSON body and credentials, and parses the success body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "l1",
            sectorId: "s1",
            code: "LN-07",
            name: "Line 7",
            isActive: true,
            extra: "stripped",
          }),
          { status: 201 },
        ),
    );
    const call = createApiClient({ baseUrl: "http://api", fetch: fetchMock });

    const result = await call(organisationContract.createLine, {
      body: { sectorId: "s1", code: "LN-07", name: "Line 7" },
    });

    expect(fetchMock).toHaveBeenCalledWith("http://api/api/lines", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectorId: "s1", code: "LN-07", name: "Line 7" }),
    });
    expect(result).toEqual({
      ok: true,
      status: 201,
      body: {
        id: "l1",
        sectorId: "s1",
        code: "LN-07",
        name: "Line 7",
        isActive: true,
      },
    });
  });

  it("puts query values in the URL", async () => {
    const fetchMock = vi.fn(
      async (_url: URL | RequestInfo, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ data: [], nextCursor: null, hasMore: false }),
          { status: 200 },
        ),
    );
    const call = createApiClient({ baseUrl: "", fetch: fetchMock });
    await call(organisationContract.listLines, {
      query: { sectorId: "s1", limit: 10 },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/lines?sectorId=s1&limit=10",
    );
  });

  it("returns the error body on a non-success status", async () => {
    const error = {
      code: "LINE_HAS_ACTIVE_ACCOUNTS",
      message: "…",
      correlationId: "req_1",
    };
    const call = createApiClient({
      baseUrl: "",
      fetch: async () => new Response(JSON.stringify(error), { status: 422 }),
    });
    const result = await call(organisationContract.deactivateLine, {
      params: { lineId: "l1" },
    });
    expect(result).toEqual({ ok: false, status: 422, body: error });
  });

  it("fails loudly when a success body does not match the contract", async () => {
    const call = createApiClient({
      baseUrl: "",
      fetch: async () =>
        new Response(JSON.stringify({ id: 42 }), { status: 200 }),
    });
    await expect(
      call(organisationContract.updateLine, {
        params: { lineId: "l1" },
        body: { name: "x" },
      }),
    ).rejects.toThrow();
  });
});
