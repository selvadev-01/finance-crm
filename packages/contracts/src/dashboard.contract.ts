import { z } from "zod";

import {
  dayCloseSchema,
  dayCloseStatusSchema,
  juniorSyncSchema,
} from "./cash.contract.js";
import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  moneyStringSchema,
  signedMoneyStringSchema,
} from "./shared.js";

/**
 * M11 Dashboards — the Super Admin business overview (US-080, S-07, PDF §17,
 * §19), the sector comparison (US-081, PDF §18, §19), the Admin operational
 * dashboard (US-082, S-20, PDF §21) and the Senior line dashboard (US-083,
 * S-19).
 *
 * **A figure that could not be computed is `null`, never `0`** (S-07): each
 * group below is read on its own, and one that fails is returned as `null`
 * while the others still arrive. A zero is a fact; `null` is "unknown".
 */

/** Whether collections are due: Sundays and declared holidays carry none (M06). */
export const dayKindSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("WORKING") }),
  z.object({ kind: z.literal("SUNDAY") }),
  z.object({ kind: z.literal("HOLIDAY"), name: z.string() }),
]);

const count = z.number().int().min(0);

/** One line's day, attributed per BR-15 (collections by `collection.lineId`). */
export const lineTodaySchema = z.object({
  lineId: idSchema,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  sectorId: idSchema,
  sectorCode: z.string(),
  sectorName: z.string(),
  /** A sector holiday makes one line's day non-working while others work. */
  day: dayKindSchema,
  /** The line's `day_close` status; `OPEN` when it has no close yet. */
  status: dayCloseStatusSchema,
  /** Σ expected of the line's slots due that date (BR-16), as S-05 shows it. */
  expected: moneyStringSchema,
  /** Σ confirmed collections on the line that date, adjustments included. */
  collected: signedMoneyStringSchema,
  /** Slots marked MISSED at the day's close. */
  missedCount: count,
  /** Originals classified LOW / EXTRA that date (BR-08). */
  lowCount: count,
  extraCount: count,
  /** The Senior assigned on that date, or null. */
  seniorName: z.string().nullable(),
  /** Juniors assigned on that date. */
  juniorCount: count,
  /** ACTIVE accounts of the line's current customers. */
  activeAccounts: count,
});

export const sectorTodaySchema = z.object({
  sectorId: idSchema,
  code: z.string(),
  name: z.string(),
  lineCount: count,
  activeAccounts: count,
  expected: moneyStringSchema,
  collected: signedMoneyStringSchema,
});

const lineRef = {
  lineId: idSchema,
  lineCode: z.string(),
  lineName: z.string(),
};

/** Something an Admin should act on, each with the page that resolves it. */
export const attentionItemSchema = z.discriminatedUnion("kind", [
  /** A handover disputed on a day that has not tallied since. */
  z.object({
    kind: z.literal("DISPUTED_HANDOVER"),
    handoverId: idSchema,
    ...lineRef,
    businessDate: calendarDateSchema,
    fromName: z.string(),
    /** declared − system. */
    discrepancy: signedMoneyStringSchema,
  }),
  /** Slots on the date marked MISSED at close. */
  z.object({ kind: z.literal("MISSED"), ...lineRef, count: count }),
  /** A working day before today that is not closed. */
  z.object({
    kind: z.literal("DAY_NOT_CLOSED"),
    ...lineRef,
    status: z.enum(["OPEN", "REOPENED"]),
  }),
  /** Corrections waiting; `awaitingYou` are those the caller did not request. */
  z.object({
    kind: z.literal("PENDING_APPROVALS"),
    count: count,
    awaitingYou: count,
  }),
  /** An active line with no Senior on the date (§15). */
  z.object({ kind: z.literal("NO_SENIOR"), ...lineRef }),
  /** An active line with active accounts and no Junior on the date. */
  z.object({ kind: z.literal("NO_JUNIOR"), ...lineRef }),
]);

export const operationsDashboardSchema = z.object({
  businessDate: calendarDateSchema,
  /** Business-wide: Sunday, or a holiday declared for every sector. */
  day: dayKindSchema,
  generatedAt: z.string(),
  /** Today's money, summed over the lines below (BR-16 per line). */
  today: z
    .object({
      expected: moneyStringSchema,
      collected: signedMoneyStringSchema,
      /** Σ per-line shortfall: expected − collected where positive. */
      pending: moneyStringSchema,
      /** Σ per-line surplus: collected − expected where positive. */
      extra: moneyStringSchema,
      lowCount: count,
      extraCount: count,
      /** Active lines with collections due that day. */
      linesToClose: count,
      /** Of those, not CLOSED or TALLIED. */
      linesNotClosed: count,
    })
    .nullable(),
  /** Corrections waiting for approval, now. */
  pendingApprovals: z.object({ total: count, awaitingYou: count }).nullable(),
  customers: z
    .object({
      /** Onboarded on the date. */
      new: count,
      /** ACTIVE customers holding at least one ACTIVE account. */
      active: count,
    })
    .nullable(),
  accounts: z
    .object({ total: count, active: count, completed: count })
    .nullable(),
  /** From the ledger's DISBURSEMENT postings (BR-18), all time. */
  investment: z
    .object({ invested: moneyStringSchema, profit: moneyStringSchema })
    .nullable(),
  sectors: z.array(sectorTodaySchema).nullable(),
  lines: z.array(lineTodaySchema).nullable(),
  /** Null when any figure it is built from could not be read. */
  attention: z.array(attentionItemSchema).nullable(),
});

// ------------------------------------------ Super Admin business overview (S-07)

/**
 * A sector's day, rolled up from its lines' `day_close` states (M11, §19),
 * over its active lines with collections due that date (the lines S-20
 * counts as "to close"):
 *
 * - `TALLIED` — every one of them is TALLIED;
 * - `CLOSED` — every one is CLOSED or TALLIED, not all TALLIED;
 * - `OPEN` — at least one is OPEN or REOPENED;
 * - `NO_COLLECTIONS` — none is due: Sunday, a holiday, or no active line.
 */
export const sectorTallySchema = z.enum([
  "TALLIED",
  "CLOSED",
  "OPEN",
  "NO_COLLECTIONS",
]);

/** One sector's day on the overview: its lines summed (§23, BR-16 per line). */
export const sectorOverviewSchema = z.object({
  sectorId: idSchema,
  code: z.string(),
  name: z.string(),
  lineCount: count,
  expected: moneyStringSchema,
  collected: signedMoneyStringSchema,
  /** Σ per-line shortfall: expected − collected where positive. */
  shortfall: moneyStringSchema,
  /** Σ per-line surplus: collected − expected where positive. */
  surplus: moneyStringSchema,
  lowCount: count,
  extraCount: count,
  /** Active lines with collections due, and how many of them are closed / tallied. */
  linesToClose: count,
  linesClosed: count,
  linesTallied: count,
  tally: sectorTallySchema,
});

/**
 * PDF §17's thirteen figures for one business date, with §19's sector tally.
 * Each group is `null` when it could not be computed — never `0` (S-07).
 */
export const businessOverviewSchema = z.object({
  businessDate: calendarDateSchema,
  /** Business-wide: Sunday, or a holiday declared for every sector. */
  day: dayKindSchema,
  /** When the figures were read — S-07's "last updated". */
  generatedAt: z.string(),
  /**
   * True before the business has any sector or any line: the screen shows a
   * setup prompt instead of a grid of zeros. Null when that is unknown.
   */
  setupNeeded: z.boolean().nullable(),
  /** Today's money, summed over the lines (BR-15 attribution, BR-16 per line). */
  today: z
    .object({
      expected: moneyStringSchema,
      /** §17's "actual". */
      collected: signedMoneyStringSchema,
      pending: moneyStringSchema,
      extra: moneyStringSchema,
      /** §17's "low": originals classified LOW that date (BR-08). */
      lowCount: count,
      extraCount: count,
    })
    .nullable(),
  /** Structural counts, now: active sectors and lines, customers not deleted. */
  structure: z
    .object({ sectors: count, lines: count, customers: count })
    .nullable(),
  accounts: z.object({ active: count, completed: count }).nullable(),
  /**
   * From the ledger's DISBURSEMENT postings (BR-18), all time: the receivable
   * debited (`A`), office cash credited (`I`), unearned profit credited (`P`).
   */
  totals: z
    .object({
      accountAmount: moneyStringSchema,
      invested: moneyStringSchema,
      profit: moneyStringSchema,
    })
    .nullable(),
  /** Sectors that have lines, by code. Null with `today` when the lines are. */
  sectors: z.array(sectorOverviewSchema).nullable(),
  /**
   * §19: of the sectors collecting that date, how many tallied, collected
   * more than expected, and collected less than expected.
   */
  tally: z
    .object({
      collecting: count,
      tallied: count,
      withExtra: count,
      withLow: count,
    })
    .nullable(),
});

// ------------------------------------------------- Sector comparison (US-081)

/**
 * A sector's day: US-080's sector row, BR-16 per line, without its identity
 * or its line count (the comparison counts active lines in `structure`).
 */
export const sectorDaySchema = sectorOverviewSchema.omit({
  sectorId: true,
  code: true,
  name: true,
  lineCount: true,
});

/** Structural counts, now: active lines, and customers not deleted on them. */
const sectorStructureSchema = z.object({ lines: count, customers: count });

/**
 * From the ledger's DISBURSEMENT postings (BR-18), all time: `A` debited to
 * the receivable, `I` credited to office cash, `P` to unearned profit.
 */
const disbursedTotalsSchema = z.object({
  accountAmount: moneyStringSchema,
  invested: moneyStringSchema,
  profit: moneyStringSchema,
});

/**
 * One sector beside the others (PDF §18). Customers and accounts belong to
 * the sector of the customer's **current** line; the day's money to the line
 * each collection was recorded under (BR-15). Each group is `null` when it
 * could not be read — never `0` (S-07).
 */
export const sectorComparisonRowSchema = z.object({
  sectorId: idSchema,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  structure: sectorStructureSchema.nullable(),
  totals: disbursedTotalsSchema.nullable(),
  /** The date's money and tally; a sector with no line that day has zeros and NO_COLLECTIONS. */
  today: sectorDaySchema.nullable(),
});

/**
 * PDF §18 and §19 for one business date: every active sector, and every
 * inactive one that has lines, side by side. `business` holds the same
 * figures read business-wide — the rows add up to it to the paisa.
 */
export const sectorComparisonSchema = z.object({
  businessDate: calendarDateSchema,
  /** Business-wide: Sunday, or a holiday declared for every sector. */
  day: dayKindSchema,
  generatedAt: z.string(),
  /** As S-07: true before any sector or line exists; null when unknown. */
  setupNeeded: z.boolean().nullable(),
  /** By sector code. Null when the sectors could not be read. */
  sectors: z.array(sectorComparisonRowSchema).nullable(),
  business: z.object({
    /** Active sectors and lines, customers not deleted — S-07's figures. */
    structure: z
      .object({ sectors: count, lines: count, customers: count })
      .nullable(),
    totals: disbursedTotalsSchema.nullable(),
    /** Every line's day summed (BR-16 per line), as S-07's `today`. */
    today: sectorDaySchema.omit({ tally: true }).nullable(),
  }),
  /** §19: of the sectors collecting that date, how many tallied, had extra, had low. */
  tally: businessOverviewSchema.shape.tally,
});

// ------------------------------------------------ Senior line dashboard (S-19)

/** An account on the line worth watching: close to done, or past its target. */
export const watchedAccountSchema = z.object({
  accountLoanId: idSchema,
  accountCode: z.string(),
  customerId: idSchema,
  customerName: z.string(),
  dailyAmount: moneyStringSchema,
  outstanding: moneyStringSchema,
  targetCompletionDate: calendarDateSchema,
  /** Calendar days past the target; 0 for an account that is not overdue. */
  daysOverdue: count,
});

/** A list with its full size; `items` holds at most the first 20. */
const watchedListSchema = z.object({
  total: count,
  items: z.array(watchedAccountSchema),
});

/**
 * One line's day for its Senior (US-083, S-19). The money, the Juniors and
 * the exceptions are the day close's own (S-05), read through the same
 * service, so the two screens can never disagree.
 */
export const lineDashboardSchema = z.discriminatedUnion("state", [
  /** A Senior with no line on today's business date: nothing to show, not an error. */
  z.object({
    state: z.literal("NO_LINE"),
    businessDate: calendarDateSchema,
    generatedAt: z.string(),
  }),
  z.object({
    state: z.literal("LINE"),
    businessDate: calendarDateSchema,
    generatedAt: z.string(),
    line: z.object({
      lineId: idSchema,
      code: z.string(),
      name: z.string(),
      sectorName: z.string(),
    }),
    /** The day's close; null when it could not be read, with everything built from it. */
    day: z
      .object({
        day: dayKindSchema,
        /** `OPEN` when the day has no close yet. */
        status: dayCloseStatusSchema,
        closedAt: z.string().nullable(),
        closedByName: z.string().nullable(),
        expected: moneyStringSchema,
        collected: signedMoneyStringSchema,
        /** BR-16: expected − collected where positive, else 0. */
        shortfall: moneyStringSchema,
        /** BR-16: collected − expected where positive, else 0. */
        surplus: moneyStringSchema,
        /** Σ acknowledged Junior → Senior handovers. */
        cashReceived: moneyStringSchema,
        /** cashReceived − collected, as S-05 shows it. */
        discrepancy: signedMoneyStringSchema,
        /** Whether any Junior → Senior handover has been acknowledged yet. */
        cashHandedOver: z.boolean(),
        handovers: z.object({ waiting: count, disputed: count }),
        juniors: z.array(juniorSyncSchema),
        exceptions: dayCloseSchema.shape.exceptions,
      })
      .nullable(),
    /** Corrections on this line waiting for a decision, now. */
    pendingApprovals: z.object({ total: count, awaitingYou: count }).nullable(),
    /** ACTIVE accounts with five collections or fewer left, now. */
    nearingCompletion: watchedListSchema.nullable(),
    /** ACTIVE accounts past their target date with money outstanding (BR-05), now. */
    overdue: watchedListSchema.nullable(),
  }),
]);

// ------------------------------------------------ Dashboard trend (S-07/S-19/S-20)

/** Working days a trend covers by default, and at most. */
export const TREND_DAYS = 30;
export const MAX_TREND_DAYS = 60;

/** One working day of the caller's lines, summed (BR-16 per line, BR-15 attribution). */
export const trendPointSchema = z.object({
  businessDate: calendarDateSchema,
  expected: moneyStringSchema,
  /** Signed: a day of only negative adjustments is below zero. */
  collected: signedMoneyStringSchema,
});

/**
 * Expected against collected per working day, ending on `businessDate` — every
 * line for an Admin (the business), a Senior's own line for them (M02).
 */
export const dashboardTrendSchema = z.object({
  /** The last date asked for; the series ends on it, or on the working day before it. */
  businessDate: calendarDateSchema,
  generatedAt: z.string(),
  days: count,
  /** Lines in the caller's scope that were summed; 0 means there is nothing to chart. */
  lineCount: count,
  /** Oldest first, working days only. Null when it could not be read — never zeros (S-07). */
  points: z.array(trendPointSchema).nullable(),
});

export const dashboardContract = {
  getOverview: route({
    method: "GET",
    path: "/api/dashboards/overview",
    summary:
      "The business overview — §17's thirteen figures and §19's sector tally — for a business date, today by default (US-080, S-07)",
    query: z.object({ date: calendarDateSchema.optional() }),
    responses: {
      200: businessOverviewSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      /** A date after today. */
      422: errorSchema,
    },
  }),

  getOperations: route({
    method: "GET",
    path: "/api/dashboards/operations",
    summary:
      "The Admin operational dashboard for a business date, today by default (US-082, S-20)",
    query: z.object({ date: calendarDateSchema.optional() }),
    responses: {
      200: operationsDashboardSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      /** A date after today. */
      422: errorSchema,
    },
  }),

  getSectors: route({
    method: "GET",
    path: "/api/dashboards/sectors",
    summary:
      "Sector comparison — §18's lines, customers and amounts and §19's collection status per sector — for a business date, today by default (US-081)",
    query: z.object({ date: calendarDateSchema.optional() }),
    responses: {
      200: sectorComparisonSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      /** A date after today. */
      422: errorSchema,
    },
  }),

  getLine: route({
    method: "GET",
    path: "/api/dashboards/line",
    summary:
      "One line's day for its Senior — their current line, or `lineId` in scope — today by default (US-083, S-19)",
    query: z.object({
      date: calendarDateSchema.optional(),
      /** Another line is 404 for a Senior (M02); omitted, the caller's current line. */
      lineId: idSchema.optional(),
    }),
    responses: {
      200: lineDashboardSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      /** A date after today. */
      422: errorSchema,
    },
  }),

  getTrend: route({
    method: "GET",
    path: "/api/dashboards/trend",
    summary:
      "Expected against collected per working day, for the caller's lines — every line for an Admin, their own for a Senior — ending today by default",
    query: z.object({
      date: calendarDateSchema.optional(),
      days: z.coerce
        .number()
        .int()
        .min(2)
        .max(MAX_TREND_DAYS)
        .default(TREND_DAYS),
      /** Another line is 404 for a Senior (M02); omitted, every line in scope. */
      lineId: idSchema.optional(),
    }),
    responses: {
      200: dashboardTrendSchema,
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      /** A date after today. */
      422: errorSchema,
    },
  }),
} as const;

export type BusinessOverview = z.infer<typeof businessOverviewSchema>;
export type SectorOverview = z.infer<typeof sectorOverviewSchema>;
export type SectorTally = z.infer<typeof sectorTallySchema>;
export type SectorDay = z.infer<typeof sectorDaySchema>;
export type SectorComparison = z.infer<typeof sectorComparisonSchema>;
export type SectorComparisonRow = z.infer<typeof sectorComparisonRowSchema>;
export type OperationsDashboard = z.infer<typeof operationsDashboardSchema>;
export type LineToday = z.infer<typeof lineTodaySchema>;
export type SectorToday = z.infer<typeof sectorTodaySchema>;
export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type DayKind = z.infer<typeof dayKindSchema>;
export type LineDashboard = z.infer<typeof lineDashboardSchema>;
export type WatchedAccount = z.infer<typeof watchedAccountSchema>;
export type TrendPoint = z.infer<typeof trendPointSchema>;
export type DashboardTrend = z.infer<typeof dashboardTrendSchema>;
