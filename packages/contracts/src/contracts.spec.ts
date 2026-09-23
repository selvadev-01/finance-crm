import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { accountTermsSchema } from "./account.contract.js";
import { buildPath, createApiClient } from "./client.js";
import { collectionContract } from "./collection.contract.js";
import { customerContract, mobileSchema } from "./customer.contract.js";
import {
  dashboardContract,
  MAX_TREND_DAYS,
  TREND_DAYS,
} from "./dashboard.contract.js";
import { holidayContract } from "./holiday.contract.js";
import { organisationContract } from "./organisation.contract.js";
import { MAX_REPORT_DAYS, reportContract } from "./report.contract.js";
import { route, successStatus } from "./route.js";
import {
  calendarDateSchema,
  codeSchema,
  formatPaiseForMessage,
  pageQuerySchema,
  toPaise,
} from "./shared.js";

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

describe("customer schemas (US-020)", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["919876543210", "+919876543210"],
  ])("normalises the mobile %j to E.164", (typed, stored) => {
    expect(mobileSchema.parse(typed)).toBe(stored);
  });

  it.each(["12345", "5876543210", "+44 7700 900123", "98765432101", ""])(
    "rejects %j as a mobile number",
    (typed) => {
      expect(mobileSchema.safeParse(typed).success).toBe(false);
    },
  );

  const valid = {
    name: "Lakshmi",
    mobile: "9876543210",
    address: "12 Market Road",
    lineId: "line-1",
    references: [{ name: "Ravi", mobile: "9123456780" }],
  };

  it("requires at least one reference person, naming the field", () => {
    const result = customerContract.createCustomer.body!.safeParse({
      ...valid,
      references: [],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(["references"]);
  });

  it("defaults the duplicate-mobile confirmation to false and drops blank optional text", () => {
    const parsed = customerContract.createCustomer.body!.parse({
      ...valid,
      notes: "  ",
      references: [{ ...valid.references[0], relation: "" }],
    });
    expect(parsed.confirmDuplicateMobile).toBe(false);
    expect(parsed.notes).toBeUndefined();
    expect(parsed.references[0]!.relation).toBeUndefined();
  });
});

describe("account terms (US-030, BR-01)", () => {
  const terms = (overrides: object = {}) => ({
    accountAmount: "10,000",
    investedAmount: "8500",
    dailyAmount: "100",
    termDays: 100,
    disbursementDate: "2026-01-03",
    ...overrides,
  });

  const issues = (input: object) => {
    const result = accountTermsSchema.safeParse(input);
    return result.success
      ? []
      : result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }));
  };

  it("accepts the reference terms, removing the commas a person typed", () => {
    const parsed = accountTermsSchema.parse(terms());
    expect(parsed.accountAmount).toBe("10000");
    expect(parsed.termDays).toBe(100);
  });

  it("refuses invested 10,500 against account 10,000: profit cannot be zero or negative", () => {
    expect(issues(terms({ investedAmount: "10500" }))).toEqual([
      {
        path: "investedAmount",
        message: expect.stringContaining("profit cannot be zero or negative"),
      },
    ]);
    expect(issues(terms({ investedAmount: "10000" }))[0]?.path).toBe(
      "investedAmount",
    );
  });

  it("refuses daily 50 over 100 days against 10,000, naming the arithmetic", () => {
    expect(issues(terms({ dailyAmount: "50" }))).toEqual([
      { path: "termDays", message: "50 × 100 days cannot clear 10,000" },
    ]);
  });

  it("accepts an exact fit D × N = A and the uneven 150 × 67, refuses one day short", () => {
    expect(issues(terms({ dailyAmount: "100", termDays: 100 }))).toEqual([]);
    expect(issues(terms({ dailyAmount: "150", termDays: 67 }))).toEqual([]);
    expect(issues(terms({ dailyAmount: "150", termDays: 66 }))).toEqual([
      { path: "termDays", message: "150 × 66 days cannot clear 10,000" },
    ]);
  });

  it.each(["0", "-5", "12.345", "abc", ""])(
    "refuses %j as an amount with the field's own message, never throwing",
    (value) => {
      const found = issues(terms({ dailyAmount: value }));
      expect(found.map((issue) => issue.path)).toEqual(["dailyAmount"]);
    },
  );

  it("US-030a: collected to date is optional, and refused at or above the account amount", () => {
    expect(issues(terms({ collectedToDate: "4,700" }))).toEqual([]);
    expect(
      accountTermsSchema.parse(terms({ collectedToDate: "4,700" }))
        .collectedToDate,
    ).toBe("4700");
    expect(issues(terms({ collectedToDate: "10000" }))).toEqual([
      {
        path: "collectedToDate",
        message: expect.stringContaining("paid in full"),
      },
    ]);
    expect(
      issues(terms({ collectedToDate: "-1" })).map((issue) => issue.path),
    ).toEqual(["collectedToDate"]);
  });

  it("formats paise for messages with Indian grouping", () => {
    expect(formatPaiseForMessage(toPaise("1234567.5"))).toBe("12,34,567.50");
    expect(formatPaiseForMessage(toPaise("999"))).toBe("999");
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
          JSON.stringify({
            data: [],
            nextCursor: null,
            hasMore: false,
            total: 0,
          }),
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

  it("treats an idempotent replay (200) as success for a route that declares one, and nowhere else", async () => {
    const collection = {
      id: "c1",
      idempotencyKey: "0b8f0e0e-1111-4c1c-9d6f-2a2b3c4d5e6f",
      accountLoanId: "a1",
      accountScheduleId: "s1",
      lineId: "l1",
      collectedByUserId: "u1",
      businessDate: "2026-09-14",
      capturedAt: "2026-09-14T04:30:00.000Z",
      syncedAt: "2026-09-14T04:30:02.000Z",
      expectedAmount: "100.00",
      amount: "100.00",
      variance: "0.00",
      classification: "CORRECT",
      note: null,
      account: {
        status: "ACTIVE",
        collectedAmount: "100.00",
        outstandingAmount: "9900.00",
        targetCompletionDate: "2026-12-30",
        actualCompletionDate: null,
      },
    };
    const replay = createApiClient({
      baseUrl: "",
      fetch: async () =>
        new Response(JSON.stringify(collection), { status: 200 }),
    });
    const result = await replay(collectionContract.recordCollection, {
      body: {
        idempotencyKey: collection.idempotencyKey,
        accountLoanId: "a1",
        amount: "100",
        capturedAt: collection.capturedAt,
      },
    });
    expect(result).toMatchObject({ ok: true, status: 200 });

    const noReplay = createApiClient({
      baseUrl: "",
      fetch: async () => new Response(JSON.stringify({}), { status: 200 }),
    });
    const created = await noReplay(organisationContract.createSector, {
      body: { code: "S-1", name: "North" },
    });
    expect(created.ok).toBe(false);
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

describe("holiday contract (US-093)", () => {
  const body = holidayContract.declareHoliday.body;

  it("treats a blank sector as business-wide", () => {
    expect(
      body.parse({ date: "2026-10-20", name: " Deepavali ", sectorId: "" }),
    ).toEqual({ date: "2026-10-20", name: "Deepavali", sectorId: undefined });
    expect(body.parse({ date: "2026-10-20", name: "Deepavali" }).sectorId).toBe(
      undefined,
    );
  });

  it("keeps a chosen sector", () => {
    expect(
      body.parse({ date: "2026-10-20", name: "Local", sectorId: "s1" })
        .sectorId,
    ).toBe("s1");
  });

  it.each([
    [{ date: "2026-02-30", name: "x" }, "date"],
    [{ date: "2026-10-20", name: "   " }, "name"],
  ])("refuses %j at %s", (input, field) => {
    const result = body.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it("lists upcoming holidays unless asked for past ones", () => {
    const query = holidayContract.listHolidays.query;
    expect(query.parse({}).period).toBe("upcoming");
    expect(query.parse({ period: "past", year: "2026" })).toMatchObject({
      period: "past",
      year: 2026,
    });
    expect(query.safeParse({ period: "soon" }).success).toBe(false);
  });
});

describe("business overview contract (US-080)", () => {
  const response = dashboardContract.getOverview.responses[200];
  const unavailable = {
    businessDate: "2026-01-05",
    day: { kind: "WORKING" },
    generatedAt: "2026-01-05T14:30:00.000Z",
    setupNeeded: null,
    today: null,
    structure: null,
    accounts: null,
    totals: null,
    sectors: null,
    tally: null,
  };
  const sector = {
    sectorId: "sec_1",
    code: "S-01",
    name: "North",
    lineCount: 2,
    expected: "1100.00",
    collected: "1050.00",
    shortfall: "100.00",
    surplus: "50.00",
    lowCount: 1,
    extraCount: 1,
    linesToClose: 2,
    linesClosed: 1,
    linesTallied: 0,
    tally: "OPEN",
  };

  it("carries each of the thirteen figures' groups as null when unknown, never as zero (S-07)", () => {
    expect(response.parse(unavailable)).toEqual(unavailable);
    expect(
      response.safeParse({ ...unavailable, totals: undefined }).success,
    ).toBe(false);
  });

  it("sends money as decimal strings and a sector's tally as one of four states", () => {
    const parsed = response.parse({ ...unavailable, sectors: [sector] });
    expect(parsed.sectors).toEqual([sector]);
    expect(
      response.safeParse({
        ...unavailable,
        totals: { accountAmount: 28000, invested: "1.00", profit: "1.00" },
      }).success,
    ).toBe(false);
    expect(
      response.safeParse({
        ...unavailable,
        sectors: [{ ...sector, tally: "REOPENED" }],
      }).success,
    ).toBe(false);
    expect(
      response.safeParse({
        ...unavailable,
        sectors: [{ ...sector, shortfall: "-1.00" }],
      }).success,
    ).toBe(false);
  });

  it("takes an optional business date, which must be a real day", () => {
    const query = dashboardContract.getOverview.query;
    expect(query.parse({})).toEqual({});
    expect(query.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });
});

describe("sector comparison contract (US-081)", () => {
  const response = dashboardContract.getSectors.responses[200];
  const unavailable = {
    businessDate: "2026-01-05",
    day: { kind: "WORKING" },
    generatedAt: "2026-01-05T14:30:00.000Z",
    setupNeeded: null,
    sectors: null,
    business: { structure: null, totals: null, today: null },
    tally: null,
  };
  const row = {
    sectorId: "sec_1",
    code: "S-01",
    name: "North",
    isActive: true,
    structure: null,
    totals: null,
    today: {
      expected: "1100.00",
      collected: "1050.00",
      shortfall: "100.00",
      surplus: "50.00",
      lowCount: 1,
      extraCount: 1,
      linesToClose: 2,
      linesClosed: 1,
      linesTallied: 0,
      tally: "OPEN",
    },
  };

  it("carries a group it could not read as null, per sector and business-wide, never as zero (S-07)", () => {
    expect(response.parse(unavailable)).toEqual(unavailable);
    expect(response.parse({ ...unavailable, sectors: [row] }).sectors).toEqual([
      row,
    ]);
    expect(
      response.safeParse({
        ...unavailable,
        business: { structure: null, totals: null },
      }).success,
    ).toBe(false);
  });

  it("sends a sector's amounts as decimal strings and refuses a number", () => {
    const totals = {
      accountAmount: "20000.00",
      invested: "17000.00",
      profit: "3000.00",
    };
    expect(
      response.parse({ ...unavailable, sectors: [{ ...row, totals }] })
        .sectors?.[0]?.totals,
    ).toEqual(totals);
    expect(
      response.safeParse({
        ...unavailable,
        sectors: [{ ...row, totals: { ...totals, profit: 3000 } }],
      }).success,
    ).toBe(false);
    expect(
      response.safeParse({
        ...unavailable,
        sectors: [{ ...row, structure: { lines: -1, customers: 0 } }],
      }).success,
    ).toBe(false);
  });

  it("takes an optional business date, which must be a real day", () => {
    const query = dashboardContract.getSectors.query;
    expect(query.parse({})).toEqual({});
    expect(query.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });
});

describe("operations dashboard contract (US-082)", () => {
  const response = dashboardContract.getOperations.responses[200];
  const unavailable = {
    businessDate: "2026-01-05",
    day: { kind: "WORKING" },
    generatedAt: "2026-01-05T14:30:00.000Z",
    today: null,
    pendingApprovals: null,
    customers: null,
    accounts: null,
    investment: null,
    sectors: null,
    lines: null,
    attention: null,
  };

  it("carries an uncomputed figure as null, not as zero (S-07)", () => {
    expect(response.parse(unavailable)).toEqual(unavailable);
    expect(
      response.safeParse({ ...unavailable, investment: undefined }).success,
    ).toBe(false);
  });

  it("sends money as decimal strings and refuses a number or a negative shortfall", () => {
    const today = {
      expected: "1500.00",
      collected: "-20.00",
      pending: "1520.00",
      extra: "0.00",
      lowCount: 0,
      extraCount: 0,
      linesToClose: 1,
      linesNotClosed: 1,
    };
    expect(response.parse({ ...unavailable, today }).today).toEqual(today);
    expect(
      response.safeParse({
        ...unavailable,
        today: { ...today, expected: 1500 },
      }).success,
    ).toBe(false);
    expect(
      response.safeParse({
        ...unavailable,
        today: { ...today, pending: "-1.00" },
      }).success,
    ).toBe(false);
  });

  it("takes an optional business date, which must be a real day", () => {
    const query = dashboardContract.getOperations.query;
    expect(query.parse({})).toEqual({});
    expect(query.parse({ date: "2026-01-05" }).date).toBe("2026-01-05");
    expect(query.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });
});

describe("dashboard trend contract", () => {
  const response = dashboardContract.getTrend.responses[200];
  const unavailable = {
    businessDate: "2026-01-06",
    generatedAt: "2026-01-06T14:30:00.000Z",
    days: 30,
    lineCount: 3,
    points: null,
  };

  it("covers thirty working days unless asked for another count between 2 and 60", () => {
    const query = dashboardContract.getTrend.query;
    expect(query.parse({}).days).toBe(TREND_DAYS);
    expect(query.parse({ days: "14" }).days).toBe(14);
    expect(query.safeParse({ days: String(MAX_TREND_DAYS + 1) }).success).toBe(
      false,
    );
    expect(query.safeParse({ days: "1" }).success).toBe(false);
    expect(query.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });

  it("reports points it could not read as null, and money only as decimal strings", () => {
    expect(response.parse(unavailable).points).toBeNull();
    const point = {
      businessDate: "2026-01-05",
      expected: "1400.00",
      collected: "-50.00",
    };
    expect(response.parse({ ...unavailable, points: [point] }).points).toEqual([
      point,
    ]);
    expect(
      response.safeParse({
        ...unavailable,
        points: [{ ...point, expected: 1400 }],
      }).success,
    ).toBe(false);
    expect(
      response.safeParse({
        ...unavailable,
        points: [{ ...point, expected: "-1.00" }],
      }).success,
    ).toBe(false);
  });
});

describe("line-wise report contract (US-084)", () => {
  const response = reportContract.getLineWise.responses[200];
  const row = {
    lineId: "line_1",
    code: "L-01",
    name: "Market Road",
    isActive: true,
    sectorId: "sec_1",
    sectorCode: "S-01",
    sectorName: "North",
    staff: { seniorName: null, juniorNames: ["Ravi"] },
    book: null,
    amounts: null,
    collections: {
      expected: "3300.00",
      collected: "-20.00",
      pending: "3320.00",
      extra: "0.00",
    },
  };
  const report = {
    from: "2026-01-01",
    to: "2026-01-07",
    generatedAt: "2026-01-07T14:30:00.000Z",
    lines: [row],
    totals: {
      lines: 1,
      book: null,
      amounts: null,
      collections: row.collections,
    },
  };

  it("carries a group it could not read as null on the rows and the totals, never as zero (S-07)", () => {
    expect(response.parse(report)).toEqual(report);
    const unavailable = { ...report, lines: null, totals: null };
    expect(response.parse(unavailable)).toEqual(unavailable);
    expect(
      response.safeParse({ ...report, lines: [{ ...row, book: undefined }] })
        .success,
    ).toBe(false);
    // The staff arrive with the line itself, so they are never unknown.
    expect(
      response.safeParse({ ...report, lines: [{ ...row, staff: null }] })
        .success,
    ).toBe(false);
  });

  it("sends money as decimal strings and refuses a number or a negative pending", () => {
    const amounts = {
      accountAmount: "20000.00",
      invested: "17000.00",
      profit: "3000.00",
    };
    expect(
      response.parse({ ...report, lines: [{ ...row, amounts }] }).lines?.[0]
        ?.amounts,
    ).toEqual(amounts);
    expect(
      response.safeParse({
        ...report,
        lines: [{ ...row, amounts: { ...amounts, profit: 3000 } }],
      }).success,
    ).toBe(false);
    expect(
      response.safeParse({
        ...report,
        lines: [
          { ...row, collections: { ...row.collections, pending: "-1.00" } },
        ],
      }).success,
    ).toBe(false);
  });

  it("takes an optional range and filters, with real days only", () => {
    const query = reportContract.getLineWise.query;
    expect(query.parse({})).toEqual({});
    expect(
      query.parse({ from: "2026-01-01", to: "2026-01-31", lineId: "line_1" }),
    ).toEqual({ from: "2026-01-01", to: "2026-01-31", lineId: "line_1" });
    expect(query.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(MAX_REPORT_DAYS).toBe(93);
  });
});

describe("investment overview contract (US-085)", () => {
  const response = reportContract.getInvestment.responses[200];
  const position = {
    accounts: 2,
    accountAmount: "20000.00",
    invested: "17000.00",
    profit: "3000.00",
    outstanding: "19100.00",
    returned: "900.00",
    profitEarned: "135.00",
    profitToEarn: "2865.00",
  };
  const range = {
    disbursements: 1,
    accountAmount: "10000.00",
    invested: "8500.00",
    profit: "1500.00",
    returned: "900.00",
    profitEarned: "135.00",
  };
  const row = {
    lineId: "line_1",
    code: "L-01",
    name: "Market Road",
    isActive: true,
    sectorId: "sec_1",
    sectorCode: "S-01",
    sectorName: "North",
    position,
    range,
  };
  const report = {
    from: "2026-01-01",
    to: "2026-01-07",
    generatedAt: "2026-01-07T14:30:00.000Z",
    lines: [row],
    totals: { lines: 1, position, range },
  };

  it("carries §22's contracted figures beside the ledger's actual position", () => {
    expect(response.parse(report)).toEqual(report);
    expect(
      response.safeParse({
        ...report,
        lines: [{ ...row, position: { ...position, profitEarned: 135 } }],
      }).success,
    ).toBe(false);
    // Money still out can never be negative; a period's movement can be.
    expect(
      response.safeParse({
        ...report,
        lines: [{ ...row, position: { ...position, outstanding: "-1.00" } }],
      }).success,
    ).toBe(false);
    const reversed = { ...range, returned: "-20.00", profitEarned: "-3.00" };
    expect(
      response.parse({ ...report, lines: [{ ...row, range: reversed }] })
        .lines?.[0]?.range,
    ).toEqual(reversed);
  });

  it("carries a group it could not read as null, never as zero (S-07)", () => {
    const partial = {
      ...report,
      lines: [{ ...row, position: null }],
      totals: { lines: 1, position: null, range },
    };
    expect(response.parse(partial)).toEqual(partial);
    const unavailable = { ...report, lines: null, totals: null };
    expect(response.parse(unavailable)).toEqual(unavailable);
    expect(
      response.safeParse({ ...report, lines: [{ ...row, range: undefined }] })
        .success,
    ).toBe(false);
  });

  it("takes the same range and filters as every report", () => {
    const query = reportContract.getInvestment.query;
    expect(query.parse({})).toEqual({});
    expect(
      query.parse({ from: "2026-01-01", to: "2026-01-31", sectorId: "sec_1" }),
    ).toEqual({ from: "2026-01-01", to: "2026-01-31", sectorId: "sec_1" });
    expect(query.safeParse({ to: "2026-02-30" }).success).toBe(false);
    expect(reportContract.getInvestment.path).toBe("/api/reports/investment");
  });
});

describe("collection report contract (US-086)", () => {
  const response = reportContract.getCollection.responses[200];
  const collections = {
    expected: "2500.00",
    collected: "1500.00",
    variance: "-1000.00",
    pending: "1000.00",
    extra: "0.00",
    missed: 1,
  };
  const classification = {
    recorded: 4,
    amount: "1500.00",
    correct: { count: 1, amount: "500.00" },
    low: { count: 1, amount: "400.00" },
    extra: { count: 1, amount: "600.00" },
    noPayment: { count: 1, amount: "0.00" },
    adjusted: { count: 0, amount: "0.00" },
  };
  const row = {
    lineId: "line_1",
    code: "L-01",
    name: "Market Road",
    isActive: true,
    sectorId: "sec_1",
    sectorCode: "S-01",
    sectorName: "North",
    collections,
    classification,
  };
  const report = {
    from: "2026-01-05",
    to: "2026-01-05",
    generatedAt: "2026-01-05T14:30:00.000Z",
    lines: [row],
    totals: { lines: 1, collections, classification },
  };

  it("carries BR-08's four classes, corrections apart, beside expected against collected", () => {
    expect(response.parse(report)).toEqual(report);
    // A correction takes money back out, so its tally may be negative.
    const corrected = {
      ...classification,
      adjusted: { count: 1, amount: "-20.00" },
    };
    expect(
      response.parse({
        ...report,
        lines: [{ ...row, classification: corrected }],
      }).lines?.[0]?.classification?.adjusted,
    ).toEqual({ count: 1, amount: "-20.00" });
    // Pending and extra are BR-16's per-day sums: never negative.
    expect(
      response.safeParse({
        ...report,
        lines: [{ ...row, collections: { ...collections, extra: "-1.00" } }],
      }).success,
    ).toBe(false);
    // A count is a whole number of entries, and money is never a JS number.
    expect(
      response.safeParse({
        ...report,
        lines: [
          {
            ...row,
            classification: {
              ...classification,
              low: { count: 1, amount: 400 },
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      response.safeParse({
        ...report,
        lines: [{ ...row, collections: { ...collections, missed: 1.5 } }],
      }).success,
    ).toBe(false);
  });

  it("carries a group it could not read as null, never as zero (S-07)", () => {
    const partial = {
      ...report,
      lines: [{ ...row, classification: null }],
      totals: { lines: 1, collections, classification: null },
    };
    expect(response.parse(partial)).toEqual(partial);
    const unavailable = { ...report, lines: null, totals: null };
    expect(response.parse(unavailable)).toEqual(unavailable);
    expect(
      response.safeParse({
        ...report,
        lines: [{ ...row, collections: undefined }],
      }).success,
    ).toBe(false);
  });

  it("takes every report's range and filters, plus the collector and one BR-08 class", () => {
    const query = reportContract.getCollection.query;
    expect(query.parse({})).toEqual({});
    expect(
      query.parse({
        from: "2026-01-01",
        to: "2026-01-31",
        lineId: "line_1",
        collectedByUserId: "user_1",
        classification: "LOW",
      }),
    ).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
      lineId: "line_1",
      collectedByUserId: "user_1",
      classification: "LOW",
    });
    // MISSED is a slot nobody visited, not a classification a row can carry.
    expect(query.safeParse({ classification: "MISSED" }).success).toBe(false);
    expect(query.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(reportContract.getCollection.path).toBe("/api/reports/collection");
  });
});
