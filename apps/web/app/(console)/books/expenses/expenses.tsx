"use client";

import { Bank, Info, Wallet } from "@phosphor-icons/react/dist/ssr";
import {
  type BankAccountView,
  booksMoneyContract,
  type Expense,
  type ExpenseCategory,
  statementsContract,
} from "@repo/contracts";
import { startOfMonth, toBusinessDate } from "@repo/domain";
import {
  Button,
  DataView,
  DialogForm,
  EmptyFrame,
  FilterBar,
  FilterField,
  FormControlField,
  FormField,
  formatBusinessDate,
  formatCurrency,
  Input,
  ListSkeleton,
  NoMatches,
  NothingYet,
  NotPermitted,
  PageHeader,
  Select,
  Stat,
  StatGrid,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";
import { useWatch } from "react-hook-form";

import {
  displayColumn,
  moneyColumn,
  valueColumn,
} from "../../../../components/columns";
import { ListFallback } from "../../../../components/list-state";
import { Pager } from "../../../../components/pager";
import { LoadFailed } from "../../../../components/query-state";
import { STATUS, StatusBadge } from "../../../../components/status-badge";
import { apiWrite } from "../../../../lib/api-write";
import { BOOKS_SIMPLE } from "../../../../lib/books-mode";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { perMille, subtractMoney, sumMoney } from "../../../../lib/money";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useListState } from "../../../../lib/use-list-state";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import { ExpenseDecision } from "../../cash/field-expenses-section";
import {
  activeBanks,
  activeCategories,
  bankLabel,
  OFFICE_CASH,
  useBanks,
  useCategories,
} from "../books-parts";
import {
  BarRows,
  CategoryIcon,
  categoryIcon,
  signedAmount,
  TileChoice,
} from "../visuals";

export const EXPENSE_FILTERS = { categoryId: "", status: "", paidFrom: "" };

type ExpenseStatus = Expense["status"];
type PaidFrom = Expense["paidFrom"];

const STATUSES = Object.keys(STATUS.decision) as ExpenseStatus[];

export const PAID_FROM_LABEL: Record<PaidFrom, string> = {
  OFFICE_CASH: "Cash in hand",
  BANK: "Bank",
  CASH_IN_HAND: "Collection staff",
};
// Simple Books (lib/books-mode.ts): no bank anywhere.
const PAID_FROM = (Object.keys(PAID_FROM_LABEL) as PaidFrom[]).filter(
  (each) => !BOOKS_SIMPLE || each !== "BANK",
);

/**
 * Books · expenses (ADR-0018, US-101; Stitch B-02). What the month cost and
 * where it went, field expenses waiting for a decision, and every expense —
 * office, bank or field — newest first. Admins record office and bank
 * expenses here; each posts to the ledger the moment it is saved.
 */
export function Expenses({
  initial,
  startRecording = false,
}: {
  initial: Partial<typeof EXPENSE_FILTERS>;
  /** Opened from a quick action on the Books overview. */
  startRecording?: boolean;
}) {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const [recording, setRecording] = useState(startRecording);
  const { filters, setFilter, reset, filtered } = useListState(
    EXPENSE_FILTERS,
    initial,
  );
  const today = toBusinessDate(new Date());
  const monthFrom = startOfMonth(today);
  const categories = useCategories(allowed);
  const banks = useBanks(allowed);
  const categoryList =
    categories.status === "ready" ? categories.data.data : [];
  const bankList = banks.status === "ready" ? banks.data.data : [];

  // The month's figures, read beside the list so a filter never moves them.
  const month = useApiQuery(
    statementsContract.getProfitAndLoss,
    allowed ? { query: { from: monthFrom, to: today } } : null,
  );
  const waiting = useApiQuery(
    booksMoneyContract.listExpenses,
    allowed
      ? { query: { paidFrom: "CASH_IN_HAND", status: "PENDING", limit: 50 } }
      : null,
  );

  // A value from the URL the API would refuse is treated as no filter.
  const status = STATUSES.find((each) => each === filters.status);
  const paidFrom = PAID_FROM.find((each) => each === filters.paidFrom);
  const categoryId = filters.categoryId || undefined;

  const expenses = usePagedQuery(
    booksMoneyContract.listExpenses,
    allowed
      ? {
          query: {
            ...(categoryId ? { categoryId } : {}),
            ...(status ? { status } : {}),
            ...(paidFrom ? { paidFrom } : {}),
          },
        }
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

  const canRecord = activeCategories(categoryList).length > 0;
  const record = (
    <Button
      tone="primary"
      onClick={() => setRecording(true)}
      disabled={!canRecord}
    >
      Record expense
    </Button>
  );
  const reloadAll = () => {
    expenses.reload();
    waiting.reload();
    month.reload();
  };
  const pending = waiting.status === "ready" ? waiting.data.data : [];
  const spent = month.status === "ready" ? month.data.expenses : null;
  const biggest = spent?.categories[0];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="What the business paid to run itself. An entry is never edited — a mistake is put right with another."
        actions={record}
      />

      <StatGrid columns={3} aria-label="This month">
        <Stat label="Expenses this month" hint="Approved, all types">
          {spent ? formatCurrency(spent.total) : "—"}
        </Stat>
        <Stat
          label="Pending approval"
          tone={pending.length > 0 ? "warning" : "neutral"}
          hint="Field expenses from staff"
        >
          {pending.length > 0
            ? `${pending.length} · ${formatCurrency(sumMoney(pending.map((each) => each.amount)))}`
            : "None"}
        </Stat>
        <Stat
          label="Biggest expense type"
          hint={
            biggest && spent
              ? `${Math.round((perMille(biggest.amount, spent.total) ?? 0) / 10)}% of this month`
              : "Nothing spent yet"
          }
        >
          {biggest ? `${biggest.name} ${formatCurrency(biggest.amount)}` : "—"}
        </Stat>
      </StatGrid>

      {pending.length > 0 ? (
        <section
          aria-label="Pending approval"
          className="flex flex-col gap-3 rounded-surface border border-warning-border bg-warning-subtle p-4"
        >
          <h2 className="text-heading text-ink">Pending approval</h2>
          <ul className="flex flex-col gap-2">
            {pending.map((expense) => {
              return (
                <li
                  key={expense.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-raised px-4 py-3"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <CategoryIcon
                      name={expense.category.name}
                      className="shrink-0 text-ink-muted"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-body font-medium text-ink">
                        {expense.spender?.name ?? "Staff"}
                        {expense.line ? ` · ${expense.line.name}` : ""}
                      </span>
                      <span className="text-caption text-ink-muted">
                        {expense.category.name} · {expense.note} ·{" "}
                        {formatBusinessDate(expense.businessDate)}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    <span
                      className="text-body font-medium text-ink"
                      data-numeric
                    >
                      {formatCurrency(expense.amount)}
                    </span>
                    <span className="inline-flex gap-2">
                      <ExpenseDecision expense={expense} onDone={reloadAll} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section
          aria-label="Expenses by type"
          className="flex flex-col gap-4 rounded-surface border border-border bg-surface-raised p-5"
        >
          <div className="flex flex-col">
            <h2 className="text-heading text-ink">Expenses by type</h2>
            <span className="text-caption text-ink-muted">
              {formatBusinessDate(monthFrom)} – {formatBusinessDate(today)}
            </span>
          </div>
          {month.status === "loading" ? (
            <ListSkeleton columns={1} rows={4} />
          ) : null}
          {month.status === "error" ? (
            <LoadFailed message={month.message} onRetry={month.reload} />
          ) : null}
          {spent ? (
            spent.categories.length === 0 ? (
              <p className="text-body text-ink-muted">
                Nothing spent this month yet.
              </p>
            ) : (
              <BarRows
                label="Expenses by type"
                rows={spent.categories.map((category) => ({
                  key: category.categoryId,
                  label: category.name,
                  amount: category.amount,
                }))}
                footer={
                  <li className="flex justify-between border-t border-border pt-3 text-body">
                    <span className="text-ink-muted">Total</span>
                    <span className="font-medium text-ink" data-numeric>
                      {formatCurrency(spent.total)}
                    </span>
                  </li>
                }
              />
            )
          ) : null}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <FilterBar
            summary={[
              categoryList.find((each) => each.id === categoryId)?.name ??
                "All categories",
              paidFrom
                ? PAID_FROM_LABEL[paidFrom].toLowerCase()
                : "paid from anywhere",
              status
                ? STATUS.decision[status].label.toLowerCase()
                : "any status",
            ].join(", ")}
          >
            <FilterField label="Expense type" width="md">
              <Select
                value={categoryId ?? ""}
                onChange={(event) =>
                  setFilter("categoryId", event.target.value)
                }
              >
                <option value="">All categories</option>
                {categoryList.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.isActive
                      ? category.name
                      : `${category.name} (retired)`}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Paid from" width="sm">
              <Select
                value={paidFrom ?? ""}
                onChange={(event) => setFilter("paidFrom", event.target.value)}
              >
                <option value="">Anywhere</option>
                {PAID_FROM.map((key) => (
                  <option key={key} value={key}>
                    {PAID_FROM_LABEL[key]}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Status" width="sm">
              <Select
                value={status ?? ""}
                onChange={(event) => setFilter("status", event.target.value)}
              >
                <option value="">Any status</option>
                {STATUSES.map((key) => (
                  <option key={key} value={key}>
                    {STATUS.decision[key].label}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>

          {expenses.status === "ready" && expenses.rows.length > 0 ? (
            <DataView
              caption="Expenses"
              rows={expenses.rows}
              getRowId={(expense) => expense.id}
              complete={expenses.pageCount <= 1}
              columns={[
                valueColumn<Expense>({
                  id: "date",
                  header: "Date",
                  value: (expense) => expense.businessDate,
                  cell: (expense) => (
                    <span className="whitespace-nowrap">
                      {formatBusinessDate(expense.businessDate)}
                    </span>
                  ),
                }),
                displayColumn<Expense>({
                  id: "what",
                  header: "Expense",
                  cell: (expense) => (
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium text-ink">
                        {expense.category.name}
                      </span>
                      <span className="text-caption text-ink-muted">
                        {expense.note}
                      </span>
                    </span>
                  ),
                }),
                valueColumn<Expense>({
                  id: "from",
                  header: "Paid from",
                  // A field expense's place already reads "Ravi's cash".
                  value: (expense) => expense.from.name,
                }),
                moneyColumn<Expense>({
                  id: "amount",
                  header: "Amount",
                  amount: (expense) => expense.amount,
                  card: "headline",
                }),
                displayColumn<Expense>({
                  id: "status",
                  header: "Status",
                  align: "end",
                  card: "status",
                  cell: (expense) =>
                    expense.status === "PENDING" && expense.canDecide ? (
                      <span className="inline-flex gap-2">
                        <ExpenseDecision expense={expense} onDone={reloadAll} />
                      </span>
                    ) : (
                      <StatusBadge kind="decision" value={expense.status} />
                    ),
                }),
              ]}
              footer={
                <Pager list={expenses} noun="expenses" nounSingular="expense" />
              }
            />
          ) : (
            <ListFallback
              query={expenses}
              columns={5}
              empty={
                filtered ? (
                  <NoMatches
                    title="No expenses match"
                    description="Nothing was paid in this category, from this place, with this status. Clear the filters to see every expense."
                    action={
                      <Button tone="link" onClick={reset}>
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <NothingYet
                    title="No expenses yet"
                    description={
                      canRecord
                        ? "Record what the business pays to run — rent, salary, fuel — so the profit it shows is the profit it made."
                        : "Add an expense type in Settings first."
                    }
                    action={canRecord ? record : undefined}
                  />
                )
              }
            />
          )}
        </div>
      </div>

      {recording ? (
        <RecordExpenseDialog
          categories={activeCategories(categoryList)}
          banks={activeBanks(bankList)}
          onClose={() => setRecording(false)}
          onRecorded={() => {
            setRecording(false);
            reloadAll();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * An office expense, paid from office cash or a bank (Stitch B-03): the
 * category as tiles, the amount, where it came from with that place's
 * balance, and what the balance will be after. Approved as it is recorded —
 * the recorder is the one who paid it — and posted at once.
 */
function RecordExpenseDialog({
  categories,
  banks,
  onClose,
  onRecorded,
}: {
  categories: readonly ExpenseCategory[];
  banks: readonly BankAccountView[];
  onClose: () => void;
  onRecorded: () => void;
}) {
  const today = toBusinessDate(new Date());
  const office = useApiQuery(booksMoneyContract.getBooksOverview, {
    query: { date: today },
  });
  const form = useZodForm(booksMoneyContract.recordExpense.body, {
    defaultValues: {
      categoryId: "",
      amount: "",
      businessDate: undefined,
      note: "",
      paidFrom: "OFFICE_CASH",
      bankAccountId: undefined,
    },
  });
  const [paidFrom, bankAccountId, amount] = useWatch({
    control: form.control,
    name: ["paidFrom", "bankAccountId", "amount"],
  });
  const officeCash = office.status === "ready" ? office.data.officeCash : null;
  const place =
    paidFrom === "BANK"
      ? banks.find((bank) => bank.id === bankAccountId)
      : undefined;
  const before = paidFrom === "BANK" ? place?.balance : officeCash;
  const typed = /^\d+(\.\d{1,2})?$/.test(String(amount ?? "").trim())
    ? String(amount).trim()
    : null;

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="Record expense"
      description={
        BOOKS_SIMPLE
          ? "Paid from cash in hand."
          : "Paid from office cash or a bank; posted on save."
      }
      submitLabel={typed ? `Record ${formatCurrency(typed)}` : "Record expense"}
      pendingLabel="Recording…"
      onSubmit={async (body) => {
        const result = await apiWrite(booksMoneyContract.recordExpense, {
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: [
              "categoryId",
              "amount",
              "businessDate",
              "note",
              "paidFrom",
              "bankAccountId",
            ],
          });
        }
        toast({
          title: `${formatCurrency(result.body.amount)} ${result.body.category.name} recorded`,
          description: `${formatBusinessDate(result.body.businessDate)} · from ${result.body.from.name}`,
        });
        onRecorded();
      }}
    >
      <FormControlField name="categoryId" label="Expense type">
        {({ field, control }) => (
          <TileChoice
            label="Expense type"
            value={field.value}
            onChange={field.onChange}
            invalid={control["aria-invalid"]}
            describedBy={control["aria-describedby"]}
            options={categories.map((category) => ({
              value: category.id,
              label: category.name,
              icon: categoryIcon(category.name),
            }))}
          />
        )}
      </FormControlField>
      <FormField name="amount" label="Amount (₹)">
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="h-12 text-title"
          data-numeric
        />
      </FormField>
      {/* Simple Books: always cash in hand, so nothing to choose. */}
      {BOOKS_SIMPLE ? null : (
        <FormControlField name="paidFrom" label="Paid from">
          {({ field }) => (
            <TileChoice
              label="Paid from"
              columns={2}
              value={field.value}
              onChange={field.onChange}
              options={[
                {
                  value: "OFFICE_CASH",
                  label: OFFICE_CASH,
                  icon: Wallet,
                  caption:
                    officeCash === null
                      ? undefined
                      : `Balance ${signedAmount(officeCash)}`,
                },
                {
                  value: "BANK",
                  label: banks.length === 0 ? "A bank (none yet)" : "A bank",
                  icon: Bank,
                  caption: banks.length === 0 ? undefined : "Choose which",
                  disabled: banks.length === 0,
                },
              ]}
            />
          )}
        </FormControlField>
      )}
      {!BOOKS_SIMPLE && paidFrom === "BANK" ? (
        <FormField name="bankAccountId" label="Bank">
          <Select>
            <option value="">Choose the bank</option>
            {banks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bankLabel(bank)} · {signedAmount(bank.balance)}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="businessDate"
          label="Date"
          hint="Leave blank for today. Never a future date."
          valueAs="optional"
        >
          <Input type="date" max={today} />
        </FormField>
        <FormField
          name="note"
          label="Note"
          hint="“September rent — Market Road office”."
          valueAs="trimmed"
        >
          <Textarea maxLength={500} rows={2} />
        </FormField>
      </div>
      {before && typed ? (
        <p
          className="rounded-control border border-accent/30 bg-accent-subtle px-4 py-2.5 text-body text-ink"
          data-numeric
        >
          {paidFrom === "BANK"
            ? place
              ? place.name
              : "The bank"
            : OFFICE_CASH}{" "}
          {signedAmount(before)} → {signedAmount(subtractMoney(before, typed))}{" "}
          after this
        </p>
      ) : null}
      <p className="flex items-start gap-2 text-caption text-ink-muted">
        <Info aria-hidden size={16} className="mt-px shrink-0" />
        An entry cannot be changed afterwards. A mistake is put right with
        another entry.
      </p>
    </DialogForm>
  );
}
