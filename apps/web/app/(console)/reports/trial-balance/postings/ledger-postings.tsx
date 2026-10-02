"use client";

import {
  ledgerContract,
  type LedgerTransactionView as Posting,
} from "@repo/contracts";
import { isCalendarDate, startOfMonth, toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  Card,
  EmptyFrame,
  FilterBar,
  FilterField,
  formatBusinessDate,
  formatCurrency,
  Input,
  NoMatches,
  NothingYet,
  NotPermitted,
  PageHeader,
  recordLinkClass,
  Select,
} from "@repo/ui";
import Link from "next/link";

import { ListFallback } from "../../../../../components/list-state";
import { PageTrail } from "../../../../../components/page-trail";
import { Pager } from "../../../../../components/pager";
import { canManageOrganisation } from "../../../../../lib/roles";
import { useListState } from "../../../../../lib/use-list-state";
import { useSignedIn } from "../../../../../lib/use-me";
import { usePagedQuery } from "../../../../../lib/use-paged-query";

const FILTERS = { from: "", to: "", type: "" };

const TYPES: Record<Posting["transactionType"], string> = {
  DISBURSEMENT: "Disbursement",
  COLLECTION: "Collection",
  HANDOVER: "Handover",
  ADJUSTMENT: "Correction",
  WRITE_OFF: "Write-off",
  CAPITAL: "Capital",
  EXPENSE: "Expense",
  BANK_TRANSFER: "Bank transfer",
  DRAWINGS: "Owner drawings",
  OTHER_INCOME: "Other income",
  JOURNAL: "Journal",
};

const ACCOUNTS: Record<Posting["entries"][number]["accountType"], string> = {
  CASH_AT_OFFICE: "Cash at office",
  CASH_IN_HAND: "Cash in hand",
  LOAN_RECEIVABLE: "Loan receivable",
  WRITE_OFF_LOSS: "Write-off loss",
  CAPITAL: "Capital",
  UNEARNED_PROFIT: "Unearned profit",
  EARNED_PROFIT: "Earned profit",
  EXPENSE: "Expense",
  BANK: "Bank",
  OTHER_INCOME: "Other income",
  OWNER_DRAWINGS: "Owner drawings",
};

const isType = (value: string): value is Posting["transactionType"] =>
  value in TYPES;

/**
 * M09 "view transactions and entries" — every posting over a date range,
 * newest first, each with its entries: which account, which side, how much.
 * Read-only. Admins and Super Admins (`ledger.view`); the API refuses anyone
 * else regardless.
 */
export function LedgerPostings({
  initial,
}: {
  initial: Partial<typeof FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const today = toBusinessDate(new Date());
  const { filters, setFilter, setFilters } = useListState(FILTERS, initial);
  const from =
    filters.from && isCalendarDate(filters.from)
      ? filters.from
      : startOfMonth(today);
  const to = filters.to && isCalendarDate(filters.to) ? filters.to : today;
  const validRange = from <= to;
  const type = isType(filters.type) ? filters.type : undefined;

  const postings = usePagedQuery(
    ledgerContract.listTransactions,
    allowed && validRange
      ? { query: { from, to, ...(type ? { type } : {}) } }
      : null,
    { url: true },
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The ledger is for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Reports", href: "/reports" },
              { label: "Trial balance", href: "/reports/trial-balance" },
              { label: "Postings" },
            ]}
          />
        }
        title="Ledger postings"
        description="Every posting the business events wrote, newest first, with the accounts each one debited and credited. Every posting balances."
        meta={
          validRange ? (
            <span>
              {formatBusinessDate(from)} – {formatBusinessDate(to)}
            </span>
          ) : null
        }
      />
      <FilterBar
        summary={[
          validRange
            ? `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`
            : "Choose a range",
          type ? TYPES[type] : "Every kind",
        ].join(", ")}
      >
        <FilterField label="From" width="sm">
          <Input
            type="date"
            value={from}
            max={today}
            onChange={(event) => setFilter("from", event.target.value)}
          />
        </FilterField>
        <FilterField label="To" width="sm">
          <Input
            type="date"
            value={to}
            max={today}
            onChange={(event) => setFilter("to", event.target.value)}
          />
        </FilterField>
        <FilterField label="Kind" width="sm">
          <Select
            value={type ?? ""}
            onChange={(event) => setFilter("type", event.target.value)}
          >
            <option value="">Every kind</option>
            {(Object.keys(TYPES) as Posting["transactionType"][]).map(
              (value) => (
                <option key={value} value={value}>
                  {TYPES[value]}
                </option>
              ),
            )}
          </Select>
        </FilterField>
      </FilterBar>

      {!validRange ? (
        <EmptyFrame>
          <NoMatches
            title="The range ends before it starts"
            description="Choose a From date on or before the To date."
          />
        </EmptyFrame>
      ) : postings.status === "ready" && postings.rows.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3" aria-label="Postings">
            {postings.rows.map((posting) => (
              <li key={posting.id}>
                <PostingCard posting={posting} />
              </li>
            ))}
          </ul>
          <Pager list={postings} noun="postings" nounSingular="posting" />
        </>
      ) : (
        <ListFallback
          query={postings}
          columns={3}
          empty={
            type ? (
              <NoMatches
                title={`No ${TYPES[type].toLowerCase()} postings in this range`}
                description="Try every kind, or a wider range."
                action={
                  <Button
                    tone="secondary"
                    onClick={() => setFilters({ type: "" })}
                  >
                    Every kind
                  </Button>
                }
              />
            ) : (
              <NothingYet
                title="Nothing posted in this range"
                description="Disbursements, collections, handovers, corrections and capital each write a posting."
              />
            )
          }
        />
      )}
    </>
  );
}

/** Where a posting came from, when the console has a page for it. */
function sourceHref(posting: Posting): string | null {
  if (posting.sourceTable === "account_loan")
    return `/accounts/${posting.sourceId}`;
  if (posting.sourceTable === "collection")
    return `/collections/${posting.sourceId}`;
  return null;
}

function PostingCard({ posting }: { posting: Posting }) {
  const href = sourceHref(posting);
  return (
    <Card.Root>
      <Card.Body>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{TYPES[posting.transactionType]}</Badge>
              {href ? (
                <Link href={href} className={recordLinkClass}>
                  {posting.description}
                </Link>
              ) : (
                <span className="font-medium text-ink">
                  {posting.description}
                </span>
              )}
            </span>
            <span className="text-caption text-ink-muted">
              {formatBusinessDate(posting.businessDate)}
              {posting.createdByName ? ` · by ${posting.createdByName}` : ""}
            </span>
          </span>
          <span className="text-heading text-ink" data-numeric>
            {formatCurrency(posting.amount)}
          </span>
        </div>
        <table className="w-full text-body">
          <caption className="sr-only">Entries</caption>
          <thead className="text-caption text-ink-muted">
            <tr>
              <th scope="col" className="py-1 text-left font-normal">
                Account
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Debit
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Credit
              </th>
            </tr>
          </thead>
          <tbody>
            {posting.entries.map((entry, index) => (
              <tr key={index} className="border-t border-border">
                <td className="py-1.5 text-ink">
                  {ACCOUNTS[entry.accountType]}
                  {entry.ownerName ? ` · ${entry.ownerName}` : ""}
                  {entry.referenceName ? ` · ${entry.referenceName}` : ""}
                  {entry.accountCode ? ` · ${entry.accountCode}` : ""}
                </td>
                <td className="py-1.5 text-right text-ink" data-numeric>
                  {entry.direction === "DEBIT"
                    ? formatCurrency(entry.amount)
                    : ""}
                </td>
                <td className="py-1.5 text-right text-ink" data-numeric>
                  {entry.direction === "CREDIT"
                    ? formatCurrency(entry.amount)
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card.Body>
    </Card.Root>
  );
}
