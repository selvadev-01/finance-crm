import { z } from "zod";

import { route } from "./route.js";
import {
  calendarDateSchema,
  errorSchema,
  idSchema,
  nameSchema,
  pageQuerySchema,
  pageSchema,
} from "./shared.js";

/**
 * M06 Working calendar — declared holidays (US-093, S-27).
 *
 * A holiday is business-wide, or for one sector. Only **future** dates can be
 * declared or removed — today and earlier are history, because a past day may
 * already have been closed and its alerts raised (BR-02, business-rules.md
 * open question 1). Declaring or removing one moves the pending schedule
 * slots it affects (US-034) and tells the staff of the lines it covers.
 */

export const holidaySchema = z.object({
  id: idSchema,
  date: calendarDateSchema,
  name: z.string(),
  /** Null for a business-wide holiday. */
  sector: z
    .object({ id: idSchema, code: z.string(), name: z.string() })
    .nullable(),
  /** Who declared it; null when not recorded (seeded or system rows). */
  addedBy: z.object({ userId: z.string(), name: z.string() }).nullable(),
  createdAt: z.string(),
  /** Whether the date is still in the future, so it may be removed. */
  removable: z.boolean(),
});

export const holidayChangeSchema = holidaySchema.extend({
  /** Accounts whose pending slots moved because of this change. */
  accountsShifted: z.number().int().min(0),
});

const errors = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
};

export const holidayContract = {
  listHolidays: route({
    method: "GET",
    path: "/api/holidays",
    summary:
      "Declared holidays the caller observes — upcoming (today onwards, soonest first) or past (latest first) (S-27)",
    query: pageQuerySchema.extend({
      period: z.enum(["upcoming", "past"]).default("upcoming"),
      /** Only holidays in this calendar year. */
      year: z.coerce.number().int().min(2000).max(2200).optional(),
    }),
    responses: { 200: pageSchema(holidaySchema), ...errors },
  }),

  declareHoliday: route({
    method: "POST",
    path: "/api/holidays",
    summary:
      "Declare a future holiday, business-wide or for one sector, shifting affected schedules (US-093)",
    body: z.object({
      date: calendarDateSchema,
      name: nameSchema,
      /** Blank or absent for a business-wide holiday. */
      sectorId: z
        .string()
        .max(64)
        .optional()
        .transform((value) => (value ? value : undefined)),
    }),
    responses: {
      201: holidayChangeSchema,
      ...errors,
      409: errorSchema,
      422: errorSchema,
    },
  }),

  removeHoliday: route({
    method: "DELETE",
    path: "/api/holidays/:holidayId",
    summary:
      "Remove a future holiday, moving affected schedules back (US-093, M06)",
    pathParams: z.object({ holidayId: idSchema }),
    responses: { 200: holidayChangeSchema, ...errors, 422: errorSchema },
  }),
} as const;

export type Holiday = z.infer<typeof holidaySchema>;
export type HolidayChange = z.infer<typeof holidayChangeSchema>;
