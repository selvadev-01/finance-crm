"use client";

import {
  accountContract,
  type AccountPreview,
  accountTermsSchema,
  customerContract,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Button,
  buttonClass,
  Card,
  DataView,
  EmptyFrame,
  Form,
  FormActions,
  FormField,
  FormMessage,
  FormRootError,
  formatBusinessDate,
  formatCurrency,
  Input,
  NotPermitted,
  PageHeader,
  Section,
  Stat,
  StatGrid,
  SubmitButton,
  useZodForm,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type BaseSyntheticEvent, useEffect, useMemo, useState } from "react";
import { useWatch } from "react-hook-form";

import {
  displayColumn,
  moneyColumn,
  valueColumn,
} from "../../../../components/columns";
import { PageTrail } from "../../../../components/page-trail";
import { RecordNotFound } from "../../../../components/query-state";
import { api } from "../../../../lib/api-client";
import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { isZeroMoney, subtractMoney } from "../../../../lib/money";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";

type Slot = AccountPreview["slots"][number];
type Terms = (typeof accountTermsSchema)["_zod"]["output"];

const SLOTS_SHOWN = 12;
const MONEY_TEXT = /^\d{1,12}(\.\d{1,2})?$/;
const TERM_FIELDS = [
  "accountAmount",
  "investedAmount",
  "dailyAmount",
  "termDays",
  "disbursementDate",
  "collectedToDate",
] as const;

/** What is sent: collected to date only for a past date (US-030a). */
function requestTerms(terms: Terms, today: string): Terms {
  if (terms.disbursementDate < today) return terms;
  const { collectedToDate: _dropped, ...rest } = terms;
  return rest;
}

/** "50 × 100 days cannot clear 10,000" → with rupee signs, as US-030 words it. */
function withRupees(message: string): string {
  return message.includes("cannot clear")
    ? message.replace(/^(\S+)/, "₹$1").replace("clear ", "clear ₹")
    : message;
}

/**
 * S-04 · US-030. Every derived value is visible before saving, because the
 * amounts cannot change after disbursement: profit updates as you type (it is
 * `A − I`, computed in paise), and once the terms are valid the API's
 * preview — the same code that will create the account — shows the first
 * collection date, the target completion date and every slot.
 */
export function NewAccountForm({ customerId }: { customerId: string }) {
  const me = useSignedIn();
  const router = useRouter();
  const manages = canManageOrganisation(me.role);
  const today = toBusinessDate(new Date());

  const customer = useApiQuery(
    customerContract.getCustomer,
    manages && customerId ? { params: { customerId } } : null,
  );
  const existing = useApiQuery(
    accountContract.listAccounts,
    manages && customerId
      ? { query: { customerId, status: "ACTIVE", limit: LIST_LIMIT } }
      : null,
  );

  // The contract's terms, plus the one rule it cannot know: a past date
  // needs what the customer has already paid (US-030a).
  const schema = useMemo(
    () =>
      accountTermsSchema.superRefine((terms, context) => {
        if (
          terms.disbursementDate < today &&
          terms.collectedToDate === undefined
        ) {
          context.addIssue({
            code: "custom",
            path: ["collectedToDate"],
            message:
              "enter what the customer has paid so far — 0 if nothing yet",
          });
        }
      }),
    [today],
  );
  const form = useZodForm(schema, {
    defaultValues: {
      accountAmount: "",
      investedAmount: "",
      dailyAmount: "",
      // M15's `account.defaultTermDays` (US-094), forward-only: it starts the
      // field for a new account and never touches one that already exists.
      termDays: String(me.organization.defaultTermDays),
      disbursementDate: today,
      collectedToDate: undefined,
    },
  });

  const watched = useWatch({ control: form.control });
  const parsed = schema.safeParse(watched);
  const valid = parsed.success;
  const previewKey = parsed.success
    ? JSON.stringify(requestTerms(parsed.data, today))
    : null;
  const disbursementDate =
    typeof watched.disbursementDate === "string"
      ? watched.disbursementDate
      : "";
  const midTerm = disbursementDate !== "" && disbursementDate < today;
  const canDisburse = disbursementDate === today;

  const [preview, setPreview] = useState<{
    key: string;
    result: AccountPreview | string;
  } | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);

  useEffect(() => {
    if (!previewKey || !customerId || !manages) return;
    let cancelled = false;
    // Debounced: a preview per settled value, not per keystroke.
    const timer = setTimeout(() => {
      api(accountContract.previewAccount, {
        body: { customerId, ...(JSON.parse(previewKey) as Terms) },
      })
        .then((result) => {
          if (cancelled) return;
          setPreview({
            key: previewKey,
            result: result.ok
              ? result.body
              : (result.body?.message ??
                "The schedule couldn’t be worked out just now."),
          });
        })
        .catch(() => {
          if (!cancelled)
            setPreview({
              key: previewKey,
              result: "Could not reach Rasi to work out the schedule.",
            });
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewKey, customerId, manages]);

  if (!manages) {
    return (
      <EmptyFrame>
        <NotPermitted />
      </EmptyFrame>
    );
  }
  if (
    !customerId ||
    customer.status === "not-found" ||
    customer.status === "not-permitted"
  ) {
    return <RecordNotFound noun="Customer" />;
  }

  // P = A − I, live, in paise — never a floating-point number (BR-11).
  const accountText = String(watched.accountAmount ?? "").replace(/[\s,]/g, "");
  const investedText = String(watched.investedAmount ?? "").replace(
    /[\s,]/g,
    "",
  );
  const profit =
    MONEY_TEXT.test(accountText) && MONEY_TEXT.test(investedText)
      ? subtractMoney(accountText, investedText)
      : null;

  const current = preview && preview.key === previewKey ? preview.result : null;
  const activeCount =
    existing.status === "ready" ? existing.data.data.length : 0;
  const cancel = (
    <Link href={`/customers/${customerId}`} className={buttonClass("ghost")}>
      Cancel
    </Link>
  );

  async function onSubmit(terms: Terms, event?: BaseSyntheticEvent) {
    const submitter = (event?.nativeEvent as SubmitEvent | undefined)
      ?.submitter;
    const disburse =
      submitter instanceof HTMLButtonElement && submitter.value === "disburse";
    const result = await apiWrite(accountContract.createAccount, {
      body: { customerId, ...requestTerms(terms, today), disburse },
    });
    if (!result.ok) {
      return applyWriteFailure(form.setError, result, {
        fields: [...TERM_FIELDS],
        fallback: "The account was not saved.",
      });
    }
    router.push(`/accounts/${result.body.id}`);
  }

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Customers", href: "/customers" },
              customer.status === "ready"
                ? {
                    label: `${customer.data.name} · ${customer.data.customerCode}`,
                    href: `/customers/${customerId}`,
                  }
                : { label: "Customer" },
              { label: "New account" },
            ]}
          />
        }
        title="New account"
        description="Amounts cannot be changed after disbursement. Check the schedule before saving."
      />

      {activeCount > 0 ? (
        <FormMessage tone="info">
          This customer already has {activeCount} active account
          {activeCount === 1 ? "" : "s"}. A further account is allowed; each
          keeps its own schedule and balance.
        </FormMessage>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Card.Root>
          <Card.Header title="Terms" />
          <Card.Body>
            <Form form={form} onSubmit={onSubmit}>
              <FormRootError />
              <FormField
                name="accountAmount"
                label="Account amount (₹)"
                hint="What the customer repays in total."
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                  data-numeric
                />
              </FormField>
              <FormField
                name="investedAmount"
                label="Invested amount (₹)"
                hint="The cash handed to the customer."
              >
                <Input inputMode="decimal" autoComplete="off" data-numeric />
              </FormField>
              <div className="flex flex-col gap-0.5 rounded-control border border-border bg-surface-sunken px-3 py-2">
                <span className="text-label text-ink-muted">Profit</span>
                <span
                  className="text-title text-ink"
                  data-numeric
                  aria-live="polite"
                >
                  {profit === null
                    ? "—"
                    : profit.startsWith("-") || isZeroMoney(profit)
                      ? "Not positive"
                      : formatCurrency(profit)}
                </span>
                <span className="text-caption text-ink-muted">
                  Account amount − invested amount. Not editable.
                </span>
              </div>
              <div className="grid gap-[var(--stack-gap)] sm:grid-cols-2">
                <FormField name="dailyAmount" label="Daily amount (₹)">
                  <Input inputMode="decimal" autoComplete="off" data-numeric />
                </FormField>
                <FormField
                  name="termDays"
                  label="Term (days)"
                  rewrite={withRupees}
                >
                  <Input inputMode="numeric" autoComplete="off" data-numeric />
                </FormField>
              </div>
              <FormField
                name="disbursementDate"
                label="Disbursement date"
                hint="Day 0 — collection starts the next working day."
              >
                <Input type="date" />
              </FormField>
              {midTerm ? (
                <FormMessage tone="warning">
                  <div className="flex flex-col gap-3">
                    <p className="font-medium">
                      A past date makes this a mid-term account: already
                      disbursed, and collected partway.
                    </p>
                    <FormField
                      name="collectedToDate"
                      label="Collected to date (₹)"
                      valueAs="optional"
                      hint="Everything paid up to and including today. Take it from the customer's collection note — never days × daily amount: one underpayment makes that wrong, and the account would finish early with money uncollected."
                    >
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        data-numeric
                      />
                    </FormField>
                  </div>
                </FormMessage>
              ) : null}

              <FormActions className="sm:flex-row-reverse sm:justify-start">
                {midTerm ? (
                  <SubmitButton value="create" pendingLabel="Saving…">
                    Save mid-term account
                  </SubmitButton>
                ) : (
                  <>
                    {/* "Save as pending" is first in the DOM, so Enter never
                        disburses: disbursing posts to the ledger and cannot be
                        undone. "Save and disburse" is moved to the end of the
                        row by `order`, not by its place in the markup. */}
                    <SubmitButton
                      tone={canDisburse ? "secondary" : "primary"}
                      value="create"
                      pendingLabel="Saving…"
                    >
                      Save as pending
                    </SubmitButton>
                    {canDisburse ? (
                      <SubmitButton
                        value="disburse"
                        pendingLabel="Saving…"
                        className="order-first"
                      >
                        Save and disburse
                      </SubmitButton>
                    ) : null}
                  </>
                )}
                {cancel}
              </FormActions>
              {!midTerm && !canDisburse ? (
                <p className="text-caption text-ink-muted">
                  A future-dated account is saved as pending and disbursed on
                  its day.
                </p>
              ) : null}
            </Form>
          </Card.Body>
        </Card.Root>

        <Section
          title="Schedule preview"
          aria-live="polite"
          className="min-w-0"
        >
          {!valid ? (
            <EmptyFrame>
              <p className="px-6 py-10 text-center text-body text-ink-muted">
                Enter valid amounts, a term and a date to see every collection
                slot.
              </p>
            </EmptyFrame>
          ) : current === null ? (
            <p className="text-body text-ink-muted" role="status">
              Working out the schedule…
            </p>
          ) : typeof current === "string" ? (
            <FormMessage tone="critical">{current}</FormMessage>
          ) : (
            <SchedulePreview
              preview={current}
              accountAmount={accountText}
              showAll={showAllSlots}
              onToggle={() => setShowAllSlots((all) => !all)}
            />
          )}
        </Section>
      </div>
    </>
  );
}

function SchedulePreview({
  preview,
  accountAmount,
  showAll,
  onToggle,
}: {
  preview: AccountPreview;
  accountAmount: string;
  showAll: boolean;
  onToggle: () => void;
}) {
  const midTerm = preview.kind === "MID_TERM";
  const firstPending = preview.slots.find((slot) => slot.status === "PENDING");
  const last = preview.slots.at(-1);
  const [rupees = "0", fraction = ""] = accountAmount.split(".");
  const total = `${rupees}.${fraction.padEnd(2, "0")}`;

  return (
    <>
      {midTerm ? (
        <StatGrid columns={3}>
          <Stat label="Collected so far">
            {formatCurrency(preview.collectedAmount)}
          </Stat>
          <Stat label="Outstanding">
            {formatCurrency(preview.outstandingAmount)}
          </Stat>
          <Stat
            label="Behind schedule"
            tone={isZeroMoney(preview.amountBehind) ? "neutral" : "warning"}
          >
            {isZeroMoney(preview.amountBehind)
              ? "Not behind"
              : formatCurrency(preview.amountBehind)}
          </Stat>
        </StatGrid>
      ) : null}
      <StatGrid columns={3}>
        <Stat label="First collection">
          {formatBusinessDate(preview.firstCollectionDate)}
        </Stat>
        <Stat label="Target completion">
          {formatBusinessDate(preview.targetCompletionDate)}
        </Stat>
        <Stat label={midTerm ? "Collection days left" : "Collection days"}>
          {preview.slots.filter((slot) => slot.status === "PENDING").length}
        </Stat>
      </StatGrid>
      <p className="text-body text-ink-muted">
        {preview.holidaysSkipped.length > 0
          ? `Skips ${preview.holidaysSkipped.map((holiday) => `${holiday.name} (${formatBusinessDate(holiday.date)})`).join(", ")}, and every Sunday.`
          : "Sundays are skipped."}
      </p>
      <DataView
        caption="Collection slots"
        rows={showAll ? preview.slots : preview.slots.slice(0, SLOTS_SHOWN)}
        getRowId={(slot) => String(slot.sequence)}
        complete={false}
        columns={[
          valueColumn<Slot>({
            id: "day",
            header: "Day",
            align: "end",
            value: (slot) => slot.sequence,
          }),
          valueColumn<Slot>({
            id: "date",
            header: "Date",
            value: (slot) => slot.dueDate,
            cell: (slot) => formatBusinessDate(slot.dueDate),
          }),
          moneyColumn<Slot>({
            id: "expected",
            header: "Expected",
            amount: (slot) => slot.expectedAmount,
          }),
          ...(midTerm
            ? [
                displayColumn<Slot>({
                  id: "status",
                  header: "Status",
                  align: "end",
                  cell: (slot) =>
                    slot.status === "COLLECTED"
                      ? "Paid before Rasi"
                      : slot.status === "PARTIAL"
                        ? "Part paid"
                        : "To collect",
                }),
              ]
            : []),
        ]}
      />
      {preview.slots.length > SLOTS_SHOWN ? (
        <div>
          <Button tone="link" onClick={onToggle}>
            {showAll ? "Show fewer" : `Show all ${preview.slots.length} slots`}
          </Button>
        </div>
      ) : null}
      <p className="text-body text-ink" data-numeric>
        {midTerm && firstPending
          ? `Collection in Rasi starts ${formatBusinessDate(firstPending.dueDate)}; the remaining slots add up to exactly ${formatCurrency(preview.outstandingAmount)}.`
          : last
            ? `The last slot expects ${formatCurrency(last.expectedAmount)}; the slots add up to exactly ${formatCurrency(total)}.`
            : null}
      </p>
    </>
  );
}
