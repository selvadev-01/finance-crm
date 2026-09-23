import { getPrismaClient } from "@repo/db";
import {
  addCalendarDays,
  dayOfWeek,
  toBusinessDate,
  toUtcMidnight,
} from "@repo/domain";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chennaiDataset } from "./data";

export const REGRESSION_FIXTURE_PATH = fileURLToPath(
  new URL("./.fixture.json", import.meta.url),
);
/** The bootstrap Super Admin's password; everyone else chooses their own. */
export const OWNER_PASSWORD = "regression-owner-password";
/** What the Admin, Senior and Junior change their temporary password to. */
export const STAFF_PASSWORD = "regression-staff-password";

export interface RegressionFixture {
  runId: string;
  organizationId: string;
  businessDate: string;
  /** Day 0 of the mid-term account: the working day before today. */
  previousWorkingDay: string;
  /** Why the journey cannot run today, if it cannot. */
  skip: string | null;
}

/**
 * The one thing the journey cannot do through the UI: someone has to sign in
 * first. Creates the organization and its owner — a Super Admin — directly,
 * exactly as the offline suite's global-setup does, and **nothing else**. The
 * owner creates the Admin through the screens, the Admin the Senior and the
 * Junior, and so on down. **Every row this run writes is permanent** (see
 * playwright.regression.config.ts).
 */
export default async function regressionSetup(): Promise<void> {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  const prisma = getPrismaClient();
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const data = chennaiDataset(runId);
  const businessDate = toBusinessDate(new Date());

  const organization = await prisma.organization.create({
    data: {
      name: data.organizationName,
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
  });

  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      name: data.owner.name,
      email: data.owner.email,
      emailVerified: true,
    },
  });
  await prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(OWNER_PASSWORD),
    },
  });
  await prisma.staffProfile.create({
    data: {
      organizationId: organization.id,
      userId,
      staffCode: `REG-OWNER-${runId}`,
      role: "SUPER_ADMIN",
      phone: `+91${data.owner.phone}`,
      joinedAt: new Date("2026-01-01"),
    },
  });

  // Sundays are the only non-working days a new business has: it has no
  // holidays until someone adds one.
  let previousWorkingDay = addCalendarDays(businessDate, -1);
  while (dayOfWeek(previousWorkingDay) === 0) {
    previousWorkingDay = addCalendarDays(previousWorkingDay, -1);
  }
  const holiday = await prisma.holiday.findFirst({
    where: {
      organizationId: organization.id,
      date: toUtcMidnight(businessDate),
    },
  });
  const skip =
    dayOfWeek(businessDate) === 0
      ? "Today is a Sunday: the route is empty by rule."
      : holiday
        ? `Today is a holiday: ${holiday.name}.`
        : minutesLeftToday() < 45
          ? "Too close to midnight in Asia/Kolkata: the business date would change mid-run."
          : null;

  const fixture: RegressionFixture = {
    runId,
    organizationId: organization.id,
    businessDate,
    previousWorkingDay,
    skip,
  };
  writeFileSync(REGRESSION_FIXTURE_PATH, JSON.stringify(fixture, null, 2));
  await prisma.$disconnect();
}

/**
 * The journey takes several minutes and every step asks the API what is due
 * "today". A run started just before midnight in Asia/Kolkata would record
 * against one business date and close another (BR-01).
 */
function minutesLeftToday(): number {
  const [hours = "0", minutes = "0"] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .split(":");
  return 24 * 60 - (Number(hours) * 60 + Number(minutes));
}
