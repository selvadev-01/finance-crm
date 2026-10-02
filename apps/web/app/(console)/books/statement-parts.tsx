"use client";

import type { AccountStatement, StatementEntry } from "@repo/contracts";
import { isCalendarDate, startOfMonth, toBusinessDate } from "@repo/domain";
import {
  AreaChart,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  Input,
  NothingYet,
  Stat,
  StatGrid,
} from "@repo/ui";

import { isZeroMoney, subtractMoney, sumMoney } from "../../../lib/money";
import { signedAmount } from "./visuals";

/** The filters every ranged statement takes; blank is "month to date". */
export const RANGE_FILTERS = { from: "", to: "" };

/**
 * The range a statement reads: `to` today or earlier, `from` on or before it
 * — anything else falls back to month to date rather than asking the API for
 * a refusal. The API holds the same rule (and the one-year cap) regardless.
 */
export function useStatementRange(filters: { from: string; to: string }) {
  const today = toBusinessDate(new Date());
  const to =
    filters.to && isCalendarDate(filters.to) && filters.to <= today
      ? filters.to
      : today;
  const from =
    filters.from && isCalendarDate(filters.from) && filters.from <= to
      ? filters.from
      : startOfMonth(to);
  return { from, to, today };
}

export function RangeFields({
  from,
  to,
  today,
  onChange,
}: {
  from: string;
  to: string;
  today: string;
  onChange: (key: "from" | "to", value: string) => void;
}) {
  return (
    <>
      <FilterField label="From" width="sm">
        <Input
          type="date"
          value={from}
          max={to}
          onChange={(event) => onChange("from", event.target.value)}
        />
      </FilterField>
      <FilterField label="To" width="sm">
        <Input
          type="date"
          value={to}
          max={today}
          onChange={(event) => onChange("to", event.target.value)}
        />
      </FilterField>
    </>
  );
}

const TYPE_LABEL: Record<StatementEntry["transactionType"], string> = {
  DISBURSEMENT: "Disbursement",
  COLLECTION: "Collection",
  HANDOVER: "Handover",
  ADJUSTMENT: "Correction",
  WRITE_OFF: "Write-off",
  CAPITAL: "Capital",
  EXPENSE: "Expense",
  BANK_TRANSFER: "Contra",
  DRAWINGS: "Drawings",
  OTHER_INCOME: "Other receipt",
  JOURNAL: "Journal voucher",
};

const WEEKDAY = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  timeZone: "UTC",
});

/**
 * Money in and out on the account's own side: for a debit-normal account
 * (cash, a bank, an expense) a debit adds; for a credit-normal one (capital,
 * income) a credit adds.
 */
function sides(statement: AccountStatement, entry: StatementEntry) {
  return statement.account.normalBalance === "DEBIT"
    ? { into: entry.debit, out: entry.credit }
    : { into: entry.credit, out: entry.debit };
}

/**
 * An account's entries over a range (Stitch B-08, B-09): opening, money in,
 * money out and closing first; then the entries grouped by day, each day
 * with its net change, and the balance after every entry on the account's
 * normal side. `chart` adds the balance over the period as a line.
 */
export function StatementEntries({
  statement,
  chart = false,
}: {
  statement: AccountStatement;
  chart?: boolean;
}) {
  const totals =
    statement.account.normalBalance === "DEBIT"
      ? { into: statement.totals.debits, out: statement.totals.credits }
      : { into: statement.totals.credits, out: statement.totals.debits };
  const days = groupByDay(statement);

  return (
    <>
      <StatGrid columns={4} aria-label="Statement figures">
        <Stat label={`Opening · ${formatBusinessDate(statement.from)}`}>
          {signedAmount(statement.opening)}
        </Stat>
        <Stat
          label="Receipts"
          hint={`${statement.entries.filter((e) => !isZeroMoney(sides(statement, e).into)).length} entries`}
        >
          {formatCurrency(totals.into)}
        </Stat>
        <Stat
          label="Payments"
          hint={`${statement.entries.filter((e) => !isZeroMoney(sides(statement, e).out)).length} entries`}
        >
          {formatCurrency(totals.out)}
        </Stat>
        <Stat label={`Closing · ${formatBusinessDate(statement.to)}`}>
          {signedAmount(statement.closing)}
        </Stat>
      </StatGrid>

      {chart && days.length > 1 ? (
        <section
          aria-label="Balance trend"
          className="flex flex-col gap-2 rounded-surface border border-border bg-surface-raised p-5"
        >
          <h2 className="text-heading text-ink">Balance trend</h2>
          <AreaChart
            label={`${statement.account.name}: balance at the end of each day`}
            series={[{ id: "balance", label: "Balance", variant: "area" }]}
            points={days.map((day) => ({
              key: day.date,
              values: { balance: day.closing },
            }))}
            formatValue={formatCurrency}
            formatKey={(key) => formatBusinessDate(key).replace(/ \d{4}$/, "")}
            formatKeyLong={formatBusinessDate}
          />
        </section>
      ) : null}

      {statement.entries.length === 0 ? (
        <NothingYet
          title="No transactions"
          description="No entries on this account between these dates."
        />
      ) : (
        <div className="overflow-x-auto rounded-surface border border-border bg-surface-raised">
          <table className="w-full min-w-[40rem] text-body">
            <caption className="sr-only">
              Entries · {statement.account.name}
            </caption>
            <thead>
              <tr className="border-b border-border bg-surface-sunken text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
                <th scope="col" className="px-4 py-2.5 text-left">
                  Particulars
                </th>
                <th scope="col" className="px-4 py-2.5 text-right">
                  Receipts
                </th>
                <th scope="col" className="px-4 py-2.5 text-right">
                  Payments
                </th>
                <th scope="col" className="px-4 py-2.5 text-right">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <th
                  scope="row"
                  className="px-4 py-2.5 text-left font-medium text-ink"
                >
                  Opening balance
                </th>
                <td />
                <td />
                <td
                  className="px-4 py-2.5 text-right font-medium text-ink"
                  data-numeric
                >
                  {signedAmount(statement.opening)}
                </td>
              </tr>
              {days.map((day) => (
                <DayRows key={day.date} statement={statement} day={day} />
              ))}
              <tr className="bg-surface-sunken">
                <th
                  scope="row"
                  className="px-4 py-3 text-left font-semibold text-ink"
                >
                  Closing balance
                </th>
                <td
                  className="px-4 py-3 text-right text-ink-muted"
                  data-numeric
                >
                  {formatCurrency(totals.into)}
                </td>
                <td
                  className="px-4 py-3 text-right text-ink-muted"
                  data-numeric
                >
                  {formatCurrency(totals.out)}
                </td>
                <td
                  className="px-4 py-3 text-right font-semibold text-ink"
                  data-numeric
                >
                  {signedAmount(statement.closing)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface Day {
  date: string;
  entries: StatementEntry[];
  /** Money in less money out over the day. */
  change: string;
  closing: string;
}

function groupByDay(statement: AccountStatement): Day[] {
  const days: Day[] = [];
  for (const entry of statement.entries) {
    let day = days.at(-1);
    if (!day || day.date !== entry.businessDate) {
      day = {
        date: entry.businessDate,
        entries: [],
        change: "0.00",
        closing: "0.00",
      };
      days.push(day);
    }
    day.entries.push(entry);
    day.closing = entry.balance;
  }
  for (const day of days) {
    const { into, out } = day.entries.reduce(
      (sum, entry) => {
        const side = sides(statement, entry);
        return { into: [...sum.into, side.into], out: [...sum.out, side.out] };
      },
      { into: [] as string[], out: [] as string[] },
    );
    day.change = subtractMoney(sumMoney(into), sumMoney(out));
  }
  return days;
}

function DayRows({
  statement,
  day,
}: {
  statement: AccountStatement;
  day: Day;
}) {
  const date = new Date(`${day.date}T00:00:00Z`);
  return (
    <>
      <tr className="border-b border-border bg-surface-sunken/60">
        <th
          scope="rowgroup"
          colSpan={4}
          className="px-4 py-1.5 text-left text-caption font-medium text-ink-muted"
        >
          <span className="flex justify-between gap-4" data-numeric>
            <span>
              {WEEKDAY.format(date)} {formatBusinessDate(day.date)}
            </span>
            <span>
              {day.change.startsWith("-") ? "" : "+"}
              {signedAmount(day.change)}
            </span>
          </span>
        </th>
      </tr>
      {day.entries.map((entry, index) => {
        const side = sides(statement, entry);
        return (
          <tr
            key={`${entry.ledgerTransactionId}:${index}`}
            className="border-b border-border last:border-b-0"
          >
            <td className="px-4 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="text-ink">{entry.description}</span>
                <span className="text-caption text-ink-muted">
                  {TYPE_LABEL[entry.transactionType]}
                </span>
              </span>
            </td>
            <td className="px-4 py-2.5 text-right text-ink" data-numeric>
              {isZeroMoney(side.into) ? "—" : formatCurrency(side.into)}
            </td>
            <td className="px-4 py-2.5 text-right text-ink" data-numeric>
              {isZeroMoney(side.out) ? "—" : formatCurrency(side.out)}
            </td>
            <td className="px-4 py-2.5 text-right text-ink" data-numeric>
              {signedAmount(entry.balance)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
