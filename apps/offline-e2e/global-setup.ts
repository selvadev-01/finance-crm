import { getPrismaClient } from "@repo/db";
import { dayOfWeek, toBusinessDate, toUtcMidnight } from "@repo/domain";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const FIXTURE_PATH = fileURLToPath(
  new URL("./.fixture.json", import.meta.url),
);
export const PASSWORD = "offline-e2e-password";
const API = "http://localhost:3001";
const WEB_ORIGIN = "http://localhost:3000";

export interface Fixture {
  runId: string;
  organizationId: string;
  businessDate: string;
  /** Why the scenarios cannot run today, if they cannot. */
  skip: string | null;
  junior: { email: string; userId: string };
  accounts: {
    id: string;
    code: string;
    customerName: string;
    outstanding: string;
  }[];
  /** US-042: one customer holding two accounts, expecting 100 and 150. */
  split: {
    customerName: string;
    accounts: { id: string; code: string; daily: string }[];
  };
}

/**
 * Builds a fresh organization through the real paths a business would use:
 * staff directly (there is no staff-creation endpoint yet, US-092), then
 * customers and **disbursed** accounts through the API as an Admin — so the
 * ledger is real. **Every row is permanent** (see playwright.config.ts).
 *
 * One shortcut, recorded here: an account created today first expects a
 * collection tomorrow (BR-03), so nothing would be due on today's route. The
 * first slot of each account is moved to today in the database — the
 * schedule is a plan and not append-only — so the route has work in it.
 */
export default async function globalSetup(): Promise<void> {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
  const prisma = getPrismaClient();
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const businessDate = toBusinessDate(new Date());

  const organization = await prisma.organization.create({
    data: {
      name: `Offline E2E ${runId}`,
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
  });
  const sector = await prisma.sector.create({
    data: {
      organizationId: organization.id,
      code: `OE2E-S-${runId}`,
      name: "Offline E2E sector",
    },
  });
  const line = await prisma.line.create({
    data: {
      organizationId: organization.id,
      sectorId: sector.id,
      code: `OE2E-L-${runId}`,
      name: "Offline E2E line",
    },
  });

  const hash = await hashPassword(PASSWORD);
  const staff = async (role: "ADMIN" | "JUNIOR") => {
    const userId = randomUUID();
    const email = `offline-e2e-${role.toLowerCase()}-${runId}@offline-e2e.rasi.test`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Offline E2E ${role.toLowerCase()}`,
        email,
        emailVerified: true,
      },
    });
    await prisma.account.create({
      data: {
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: hash,
      },
    });
    const profile = await prisma.staffProfile.create({
      data: {
        organizationId: organization.id,
        userId,
        staffCode: `OE2E-${role}-${runId}`,
        role,
        phone: `+9170${runId.slice(-8)}${role === "ADMIN" ? "1" : "2"}`,
        joinedAt: new Date("2026-01-01"),
      },
    });
    return { email, userId, staffProfileId: profile.id };
  };
  await staff("ADMIN");
  const admin = { email: `offline-e2e-admin-${runId}@offline-e2e.rasi.test` };
  const junior = await staff("JUNIOR");
  await prisma.lineAssignment.create({
    data: {
      lineId: line.id,
      staffProfileId: junior.staffProfileId,
      assignmentRole: "JUNIOR",
      effectiveFrom: new Date("2026-01-01"),
    },
  });

  await waitFor(`${API}/health/live`);
  const cookie = await signIn(admin.email);
  const call = async (path: string, body: object) => {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: WEB_ORIGIN,
      },
      body: JSON.stringify(body),
    });
    if (response.status >= 300) {
      throw new Error(
        `${path} answered ${response.status}: ${await response.text()}`,
      );
    }
    return response.json() as Promise<{
      id: string;
      accountCode: string;
      outstandingAmount: string;
    }>;
  };

  const accounts: Fixture["accounts"] = [];
  // One account per scenario, so each starts from an untouched balance.
  const names = [
    "Lakshmi Narayanan",
    "Meena Devi",
    "Arun Kumar",
    "Suresh Babu",
  ];
  for (const [index, name] of names.entries()) {
    const customer = await call("/api/customers", {
      name,
      mobile: `9${runId.slice(-8)}${index}`,
      address: `${index + 1} Market Road`,
      lineId: line.id,
      references: [{ name: "Ravi", mobile: "9123400001" }],
      confirmDuplicateMobile: true,
    });
    const account = await call("/api/accounts", {
      customerId: customer.id,
      accountAmount: "1000",
      investedAmount: "850",
      dailyAmount: "100",
      termDays: 10,
      disbursementDate: businessDate,
      disburse: true,
    });
    await prisma.accountSchedule.updateMany({
      where: { accountLoanId: account.id, sequence: 1 },
      data: { dueDate: toUtcMidnight(businessDate) },
    });
    accounts.push({
      id: account.id,
      code: account.accountCode,
      customerName: name,
      outstanding: account.outstandingAmount,
    });
  }

  // US-042: a second customer shape — two accounts, one customer.
  const splitName = "Kavitha Rajan";
  const splitCustomer = await call("/api/customers", {
    name: splitName,
    mobile: `8${runId.slice(-8)}5`,
    address: "5 Market Road",
    lineId: line.id,
    references: [{ name: "Ravi", mobile: "9123400001" }],
    confirmDuplicateMobile: true,
  });
  const split: Fixture["split"] = { customerName: splitName, accounts: [] };
  for (const [accountAmount, investedAmount, dailyAmount] of [
    ["1000", "850", "100"],
    ["1500", "1275", "150"],
  ] as const) {
    const account = await call("/api/accounts", {
      customerId: splitCustomer.id,
      accountAmount,
      investedAmount,
      dailyAmount,
      termDays: 10,
      disbursementDate: businessDate,
      disburse: true,
    });
    await prisma.accountSchedule.updateMany({
      where: { accountLoanId: account.id, sequence: 1 },
      data: { dueDate: toUtcMidnight(businessDate) },
    });
    split.accounts.push({
      id: account.id,
      code: account.accountCode,
      daily: `${dailyAmount}.00`,
    });
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
        : null;

  const fixture: Fixture = {
    runId,
    organizationId: organization.id,
    businessDate,
    skip,
    junior: { email: junior.email, userId: junior.userId },
    accounts,
    split,
  };
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2));
  await prisma.$disconnect();
}

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not come up`);
}

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: WEB_ORIGIN },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`sign-in answered ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
