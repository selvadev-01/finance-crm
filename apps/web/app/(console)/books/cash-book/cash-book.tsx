"use client";

import { Bank, Wallet } from "@phosphor-icons/react/dist/ssr";
import {
  booksMoneyContract,
  exportContract,
  statementsContract,
} from "@repo/contracts";
import {
  EmptyFrame,
  FilterBar,
  formatBusinessDate,
  ListSkeleton,
  NotPermitted,
  PageHeader,
} from "@repo/ui";

import { ExportMenu } from "../../../../components/export-menu";
import { LoadFailed } from "../../../../components/query-state";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import { bankLabel, OFFICE_CASH, useBanks } from "../books-parts";
import {
  RANGE_FILTERS,
  RangeFields,
  StatementEntries,
  useStatementRange,
} from "../statement-parts";
import { signedAmount, TileChoice } from "../visuals";

export const CASH_BOOK_FILTERS = { ...RANGE_FILTERS, bank: "" };

/**
 * Books · cash book (ADR-0018, US-105; Stitch B-08): every rupee in and out of
 * office cash, or of one bank, between two dates — opening, in, out, closing,
 * then the entries day by day with the balance after each. The book an owner
 * checks against the drawer and the passbook.
 */
export function CashBookView({
  initial,
}: {
  initial: Partial<typeof CASH_BOOK_FILTERS>;
}) {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const { filters, setFilter } = useListState(CASH_BOOK_FILTERS, initial);
  const { from, to, today } = useStatementRange(filters);
  const banks = useBanks(allowed);
  const overview = useApiQuery(
    booksMoneyContract.getBooksOverview,
    allowed ? { query: { date: today } } : null,
  );
  const bankList = banks.status === "ready" ? banks.data.data : [];
  // A bank from the URL that is not one of ours reads as office cash.
  const bank = bankList.find((each) => each.id === filters.bank);
  const query = { from, to, ...(bank ? { bankAccountId: bank.id } : {}) };
  const book = useApiQuery(
    statementsContract.getCashBook,
    allowed && (filters.bank === "" || banks.status !== "loading")
      ? { query }
      : null,
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The books are for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  return (
    <>
      <PageHeader
        title="Cash book"
        description="Every rupee in and out, with the balance after each — check it against the drawer or the passbook."
        actions={
          <ExportMenu
            route={exportContract.cashBook}
            query={query}
            disabled={book.status !== "ready"}
          />
        }
      />

      <TileChoice
        label="Cash / bank book"
        columns={3}
        value={bank?.id ?? "office"}
        onChange={(value) => setFilter("bank", value === "office" ? "" : value)}
        options={[
          {
            value: "office",
            label: OFFICE_CASH,
            icon: Wallet,
            caption:
              overview.status === "ready"
                ? signedAmount(overview.data.officeCash)
                : undefined,
          },
          ...bankList.map((each) => ({
            value: each.id,
            label: each.isActive
              ? bankLabel(each)
              : `${bankLabel(each)} (retired)`,
            icon: Bank,
            caption: signedAmount(each.balance),
          })),
        ]}
      />

      <FilterBar
        summary={`${bank ? bankLabel(bank) : OFFICE_CASH}, ${formatBusinessDate(from)} – ${formatBusinessDate(to)}`}
      >
        <RangeFields
          from={from}
          to={to}
          today={today}
          onChange={(key, value) => setFilter(key, value)}
        />
      </FilterBar>

      {book.status === "loading" ? <ListSkeleton columns={4} /> : null}
      {book.status === "error" ? (
        <LoadFailed message={book.message} onRetry={book.reload} />
      ) : null}
      {book.status === "ready" ? (
        <StatementEntries statement={book.data} />
      ) : null}
    </>
  );
}
