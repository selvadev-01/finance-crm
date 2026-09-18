import { z } from "zod";

import { classificationSchema } from "./collection.contract.js";
import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  moneyStringSchema,
  pageQuerySchema,
  pageSchema,
  signedMoneyStringSchema,
} from "./shared.js";

/**
 * M12 Reports — questions over a chosen date range, with filters.
 *
 * The pattern every report follows (US-084 set it):
 *
 * - **Date-bounded.** `from` and `to` are inclusive business dates; blank
 *   `to` is today and blank `from` is the first day of `to`'s month. `to`
 *   after today is `422 DATE_IN_FUTURE`; `from` after `to`, or a range of
 *   more than {@link MAX_REPORT_DAYS} days, is `400 INVALID_DATE_RANGE`.
 * - **Scoped before filtered** (M02). A Senior's "every line" is their own
 *   line; a sector or line outside the caller's scope is `404`.
 * - **The same readers as the dashboards**, so a report over one day equals
 *   the dashboard for that day.
 * - **A group that could not be read is `null`, never `0`** (S-07) — on
 *   every row and in the totals at once.
 */

/** Inclusive days a report may span: a quarter, as the collection list (S-16). */
export const MAX_REPORT_DAYS = 93;

/** The range and filters every report takes. */
export const reportRangeQuerySchema = z.object({
  /** Blank: the first day of `to`'s month. */
  from: calendarDateSchema.optional(),
  /** Blank: today. */
  to: calendarDateSchema.optional(),
});

const count = z.number().int().min(0);

/** Customers and accounts on the line, now: they follow the customer's current line. */
const lineBookSchema = z.object({
  /** Customers not deleted. */
  customers: count,
  /** Accounts of those customers, in any state. */
  accounts: count,
  activeAccounts: count,
  completedAccounts: count,
});

/**
 * From the ledger's DISBURSEMENT postings (BR-18), all time, for the
 * accounts the line holds now: `A` debited to the receivable, `I` credited
 * to office cash, `P` to unearned profit.
 */
const lineAmountsSchema = z.object({
  accountAmount: moneyStringSchema,
  invested: moneyStringSchema,
  profit: moneyStringSchema,
});

/**
 * The range's money, BR-16 taken **per line, per day** and then summed — a
 * surplus on Tuesday never hides Monday's shortfall. Expected follows each
 * slot's account to its customer's current line; collected is by
 * `collection.lineId` (BR-15).
 */
const lineCollectionsSchema = z.object({
  expected: moneyStringSchema,
  /** §14's "actual", adjustments included. */
  collected: signedMoneyStringSchema,
  /** Σ daily shortfall: expected − collected where positive. */
  pending: moneyStringSchema,
  /** Σ daily surplus: collected − expected where positive. */
  extra: moneyStringSchema,
});

/** One line, PDF §14's columns. */
export const lineWiseRowSchema = z.object({
  lineId: idSchema,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  sectorId: idSchema,
  sectorCode: z.string(),
  sectorName: z.string(),
  /** Assigned on the range's last day; read with the line itself. */
  staff: z.object({
    seniorName: z.string().nullable(),
    juniorNames: z.array(z.string()),
  }),
  book: lineBookSchema.nullable(),
  amounts: lineAmountsSchema.nullable(),
  collections: lineCollectionsSchema.nullable(),
});

/**
 * The line-wise report (US-084, PDF §14). `totals` is the rows summed
 * exactly; a group is `null` there when it is `null` on the rows.
 */
export const lineWiseReportSchema = z.object({
  from: calendarDateSchema,
  to: calendarDateSchema,
  generatedAt: z.string(),
  /**
   * Active lines in scope and filter, by code, and an inactive one that
   * carried money in the range or was asked for by `lineId`. Null when the
   * lines could not be read.
   */
  lines: z.array(lineWiseRowSchema).nullable(),
  totals: z
    .object({
      lines: count,
      book: lineBookSchema.nullable(),
      amounts: lineAmountsSchema.nullable(),
      collections: lineCollectionsSchema.nullable(),
    })
    .nullable(),
});

/**
 * §22 as **contracted** at disbursement, from the ledger's DISBURSEMENT
 * postings (BR-18's `A`, `I` and `P`), all time, for the accounts the line
 * holds now — the same figures the line-wise report and the dashboards show.
 */
const investmentContractedSchema = z.object({
  /** Accounts disbursed through Rasi, in any state. */
  accounts: count,
  /** `A` — Σ the receivables' opening debits. */
  accountAmount: moneyStringSchema,
  /** `I` — the capital that left the business. */
  invested: moneyStringSchema,
  /** `P` — the profit the accounts promise. */
  profit: moneyStringSchema,
});

/**
 * The **actual** position now, from the ledger alone: each receivable's
 * balance is what is still out, `A −` that balance is what came back, and the
 * profit on it is BR-18's `round(collected × P / A)` **per account** — profit
 * recognised on money received, not on money promised.
 */
export const investmentPositionSchema = investmentContractedSchema.extend({
  /** Σ the receivables' balances: money still out. */
  outstanding: moneyStringSchema,
  /** `accountAmount − outstanding`: money returned, principal and profit together. */
  returned: moneyStringSchema,
  /** BR-18 on the running total, per account, then summed. */
  profitEarned: moneyStringSchema,
  /** `profit − profitEarned`: what `UNEARNED_PROFIT` still holds. */
  profitToEarn: moneyStringSchema,
});

/**
 * What the ledger recorded **between `from` and `to`**, by posting date: the
 * capital deployed in the period against the profit recognised in it. Returned
 * and earned are net of ADJUSTMENT postings (US-044), so both may be negative.
 */
export const investmentMovementSchema = z.object({
  /** Accounts disbursed in the period. */
  disbursements: count,
  /** `A` of those disbursements. */
  accountAmount: moneyStringSchema,
  /** `I` of those disbursements — the capital deployed in the period. */
  invested: moneyStringSchema,
  /** `P` of those disbursements. */
  profit: moneyStringSchema,
  /** Receivable credits less debits, from COLLECTION and ADJUSTMENT postings. */
  returned: signedMoneyStringSchema,
  /** `EARNED_PROFIT` credits less debits — BR-18's deltas, summed. */
  profitEarned: signedMoneyStringSchema,
});

/** One line, PDF §22: its investment as contracted, as it stands, and as it moved. */
export const investmentRowSchema = z.object({
  lineId: idSchema,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  sectorId: idSchema,
  sectorCode: z.string(),
  sectorName: z.string(),
  /** Contracted and actual, as of now. Null when the ledger could not be read. */
  position: investmentPositionSchema.nullable(),
  /** The period's own postings. Null when they could not be read. */
  range: investmentMovementSchema.nullable(),
});

/**
 * The investment overview (US-085, PDF §22). `totals` is the rows summed
 * exactly — "and overall" — with a group `null` there when it is `null` on
 * the rows.
 */
export const investmentReportSchema = z.object({
  from: calendarDateSchema,
  to: calendarDateSchema,
  generatedAt: z.string(),
  /**
   * Active lines in scope and filter, by code, and an inactive one that still
   * carries an investment, moved money in the period, or was asked for by
   * `lineId`. Null when the lines could not be read.
   */
  lines: z.array(investmentRowSchema).nullable(),
  totals: z
    .object({
      lines: count,
      position: investmentPositionSchema.nullable(),
      range: investmentMovementSchema.nullable(),
    })
    .nullable(),
});

/**
 * The range's money for one line, as {@link lineCollectionsSchema}, with the
 * whole range's variance and the visits nobody recorded. BR-16 is still taken
 * per day for `pending` and `extra`; `variance` is the plain difference over
 * the range, which is what "expected versus collected" means on a report.
 */
const collectionComparisonSchema = lineCollectionsSchema.extend({
  /** `collected − expected` over the range: negative when the line is short. */
  variance: signedMoneyStringSchema,
  /**
   * Slots due in the range that the day close marked `MISSED` — a visit that
   * did not happen, which is a staff failure and never a `NO_PAYMENT` (BR-09).
   * A schedule fact, so the collector and classification filters leave it be.
   */
  missed: count,
});

/** One of BR-08's classes over the range: how many entries, and their money. */
const classificationTallySchema = z.object({
  count,
  /** Σ the entries' amounts. Signed only because an adjustment may be negative. */
  amount: signedMoneyStringSchema,
});

/**
 * BR-08 over the range, for the entries matching every filter: each visit
 * counted once under the class it was written with (classification is computed
 * at write time, never re-derived — BR-08), and corrections kept apart.
 *
 * Unfiltered, `correct + low + extra + noPayment + adjusted` amounts to the
 * comparison's `collected` exactly, because both read the same CONFIRMED rows
 * on the same business dates (BR-15).
 */
const classificationBreakdownSchema = z.object({
  /** ORIGINAL entries: one per visit. */
  recorded: count,
  /** Σ those entries' amounts. */
  amount: signedMoneyStringSchema,
  correct: classificationTallySchema,
  low: classificationTallySchema,
  extra: classificationTallySchema,
  noPayment: classificationTallySchema,
  /**
   * Approved corrections (US-044, BR-14) that landed in the range: the signed
   * difference each one moved. Never a visit, so never one of the four.
   */
  adjusted: classificationTallySchema,
});

/** One line, for the collection report (US-086). */
export const collectionReportRowSchema = z.object({
  lineId: idSchema,
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  sectorId: idSchema,
  sectorCode: z.string(),
  sectorName: z.string(),
  /** Expected against collected for the whole line. Null when unreadable. */
  collections: collectionComparisonSchema.nullable(),
  /** BR-08's breakdown of the entries asked for. Null when unreadable. */
  classification: classificationBreakdownSchema.nullable(),
});

/**
 * The collection report (US-086): what was collected over a date range,
 * against what was expected, with BR-08's classification breakdown — per line,
 * and `totals` the rows summed exactly.
 */
export const collectionReportSchema = z.object({
  from: calendarDateSchema,
  to: calendarDateSchema,
  generatedAt: z.string(),
  /**
   * Active lines in scope and filter, by code, and an inactive one that
   * carried money in the range or was asked for by `lineId`. Null when the
   * lines could not be read.
   */
  lines: z.array(collectionReportRowSchema).nullable(),
  totals: z
    .object({
      lines: count,
      collections: collectionComparisonSchema.nullable(),
      classification: classificationBreakdownSchema.nullable(),
    })
    .nullable(),
});

/**
 * What the plan says the account should have paid by now, against what it did
 * (US-087). BR-16's per-day pending, read **per account**: for every slot due
 * on or before today, the part of that day's expected amount the day's
 * collections did not cover. Taken per day, so paying ₹200 on Tuesday never
 * erases Monday's ₹100 shortfall — and a Sunday or a declared holiday has no
 * slot at all (BR-02, BR-09), so it can never put an account in arrears.
 *
 * Null only when the schedule and its collections could not be read (S-07).
 */
const overdueArrearsSchema = z.object({
  /** Σ over the due days of `max(expected − collected, 0)`. */
  amount: moneyStringSchema,
  /** How many of those days are still short — missed visits and part payments alike. */
  unpaidDays: count,
  /**
   * The last visit recorded on the account (BR-08's ORIGINAL entry, a
   * `NO_PAYMENT` included), or `null` when nothing has ever been recorded.
   */
  lastCollection: z
    .object({
      businessDate: calendarDateSchema,
      amount: signedMoneyStringSchema,
      /** Calendar days from that date to today. */
      daysAgo: count,
    })
    .nullable(),
});

/** One account past its target completion date, for the overdue report (US-087). */
export const overdueAccountSchema = z.object({
  accountLoanId: idSchema,
  accountCode: z.string(),
  customerId: idSchema,
  customerName: z.string(),
  /** The customer's **current** line — the book that collects the account now. */
  lineId: idSchema,
  lineCode: z.string(),
  lineName: z.string(),
  sectorId: idSchema,
  sectorName: z.string(),
  /** `D`, what the customer pays on a collection day (BR-01). */
  dailyAmount: moneyStringSchema,
  /** `A`, the money owed at disbursement. */
  accountAmount: moneyStringSchema,
  /** `A − collected`, the balance BR-05 completes on. Always more than zero here. */
  outstanding: moneyStringSchema,
  /** Recomputed after every collection (BR-06); in the past on every row here. */
  targetCompletionDate: calendarDateSchema,
  /** Calendar days from `targetCompletionDate` to today — at least 1 (BR-05). */
  daysOverdue: z.number().int().min(1),
  arrears: overdueArrearsSchema.nullable(),
});

/**
 * The whole set of overdue accounts, not the page: the band above the table.
 * Null when it could not be read (S-07) — never zeros.
 */
export const overdueSummarySchema = z.object({
  accounts: count,
  /** How many lines those accounts sit on. */
  lines: count,
  /** Σ the accounts' outstanding balances. */
  outstanding: moneyStringSchema,
  /** Σ their arrears, the same per-day figure each row carries. */
  arrears: moneyStringSchema,
  /** The account that has been overdue longest; null when there are none. */
  longestOverdue: z
    .object({
      accountLoanId: idSchema,
      accountCode: z.string(),
      customerName: z.string(),
      daysOverdue: z.number().int().min(1),
    })
    .nullable(),
});

/**
 * The overdue report (US-087): the accounts still active past their target
 * completion date, one row each, cursor-paged as the collection list is.
 *
 * Unlike the other three reports this one takes no date range — it is the
 * position **now**. BR-06 regenerates a schedule's tail after every
 * collection, so "who was overdue on 3 March" cannot be reconstructed from
 * the plan as it stands today, and a date parameter would invite exactly that
 * question.
 */
export const overdueReportSchema = pageSchema(overdueAccountSchema).extend({
  /** Today's business date, the day every `daysOverdue` is measured to (BR-12). */
  asOf: calendarDateSchema,
  generatedAt: z.string(),
  summary: overdueSummarySchema.nullable(),
});

/** How the overdue rows are ordered — the two figures M12 names. */
export const overdueSortSchema = z.enum(["daysOverdue", "outstanding"]);

export const reportContract = {
  getLineWise: route({
    method: "GET",
    path: "/api/reports/line-wise",
    summary:
      "Line-wise report — §14's figures per line over a date range, with totals (US-084)",
    query: reportRangeQuerySchema.extend({
      sectorId: idSchema.optional(),
      lineId: idSchema.optional(),
    }),
    responses: {
      200: lineWiseReportSchema,
      /** A malformed date, or a range that is reversed or too long. */
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      /** A sector or line that does not exist or is outside the caller's scope. */
      404: errorSchema,
      /** `to` after today. */
      422: errorSchema,
    },
  }),
  getInvestment: route({
    method: "GET",
    path: "/api/reports/investment",
    summary:
      "Investment overview — §22's account amount, invested and profit per line and overall, contracted against the ledger's actual position (US-085)",
    query: reportRangeQuerySchema.extend({
      sectorId: idSchema.optional(),
      lineId: idSchema.optional(),
    }),
    responses: {
      200: investmentReportSchema,
      /** A malformed date, or a range that is reversed or too long. */
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      /** A sector or line that does not exist or is outside the caller's scope. */
      404: errorSchema,
      /** `to` after today. */
      422: errorSchema,
    },
  }),
  getCollection: route({
    method: "GET",
    path: "/api/reports/collection",
    summary:
      "Collection report — what each line collected against what was expected over a date range, with BR-08's classification breakdown (US-086)",
    query: reportRangeQuerySchema.extend({
      sectorId: idSchema.optional(),
      lineId: idSchema.optional(),
      /** One collector, by their user id: the Junior whose pattern is in question. */
      collectedByUserId: idSchema.optional(),
      /** One of BR-08's four classes; the breakdown then covers only it. */
      classification: classificationSchema.optional(),
    }),
    responses: {
      200: collectionReportSchema,
      /** A malformed date, or a range that is reversed or too long. */
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      /**
       * A sector, line or staff member that does not exist or is outside the
       * caller's scope.
       */
      404: errorSchema,
      /** `to` after today. */
      422: errorSchema,
    },
  }),
  getOverdue: route({
    method: "GET",
    path: "/api/reports/overdue",
    summary:
      "Overdue report — the accounts still active past their target completion date, with what they are behind by (US-087)",
    query: pageQuerySchema.extend({
      sectorId: idSchema.optional(),
      lineId: idSchema.optional(),
      /** Only accounts overdue by at least this many calendar days. */
      minDaysOverdue: z.coerce.number().int().min(1).max(3650).optional(),
      sort: overdueSortSchema.default("daysOverdue"),
    }),
    responses: {
      200: overdueReportSchema,
      /** A cursor this API did not issue, or a filter that is not a number. */
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      /** A sector or line that does not exist or is outside the caller's scope. */
      404: errorSchema,
    },
  }),
} as const;

export type LineWiseReport = z.infer<typeof lineWiseReportSchema>;
export type LineWiseRow = z.infer<typeof lineWiseRowSchema>;
export type InvestmentReport = z.infer<typeof investmentReportSchema>;
export type InvestmentRow = z.infer<typeof investmentRowSchema>;
export type CollectionReport = z.infer<typeof collectionReportSchema>;
export type CollectionReportRow = z.infer<typeof collectionReportRowSchema>;
export type OverdueReport = z.infer<typeof overdueReportSchema>;
export type OverdueAccount = z.infer<typeof overdueAccountSchema>;
export type OverdueSummary = z.infer<typeof overdueSummarySchema>;
export type OverdueSort = z.infer<typeof overdueSortSchema>;
