"use client";

import {
  accountContract,
  type AccountPreview,
  accountTermsSchema,
  booksMoneyContract,
  customerContract,
} from "@repo/contracts";
import {
  type CollectionFrequency,
  COLLECTION_FREQUENCIES,
  toBusinessDate,
} from "@repo/domain";
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
  Select,
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
import { CADENCE, cadenceOf } from "../../../../lib/cadence";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import {
  isNegativeMoney,
  isZeroMoney,
  subtractMoney,
} from "../../../../lib/money";
import {
  canApproveAccount,
  canCreateAccount,
  canDisburse,
  canManageOrganisation,
} from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { signedAmount } from "../../books/visuals";

type Slot = AccountPreview["slots"][number];
type Terms = (typeof accountTermsSchema)["_zod"]["output"];

const SLOTS_SHOWN = 12;
const MONEY_TEXT = /^\d{1,12}(\.\d{1,2})?$/;
const TERM_FIELDS = [
  "accountAmount",
  "investedAmount",
  "dailyAmount",
  "termDays",
  "collectionFrequency",
  "disbursementDate",
  "collectedToDate",
] as const;

/** What is sent: collected to date only for a past date (US-030a). */
function requestTerms(terms: Terms, today: string): Terms {
  if (terms.disbursementDate < today) return terms;
  const { collectedToDate: _dropped, ...rest } = terms;
  return rest;
}

/** "Pongal (14 Jan 2026), Republic Day (26 Jan 2026)". */
function holidayList(holidays: AccountPreview["holidaysSkipped"]): string {
  return holidays
    .map((holiday) => `${holiday.name} (${formatBusinessDate(holiday.date)})`)
    .join(", ");
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
  // A Senior opens accounts too, for customers on their own lines; theirs
  // wait for an Admin to approve (decided 2026-10-03).
  const mayCreate = canCreateAccount(me.role);
  const manages = canManageOrganisation(me.role);
  const needsApproval = !canApproveAccount(me.role);
  const today = toBusinessDate(new Date());

  const customer = useApiQuery(
    customerContract.getCustomer,
    mayCreate && customerId ? { params: { customerId } } : null,
  );
  const existing = useApiQuery(
    accountContract.listAccounts,
    mayCreate && customerId
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
      // BR-04: daily is the business's normal round, so it is what the form
      // opens on; the other two are a deliberate choice.
      collectionFrequency: "DAILY",
      disbursementDate: today,
      collectedToDate: undefined,
    },
  });

  const watched = useWatch({ control: form.control });
  const cadence = CADENCE[cadenceOf(watched.collectionFrequency)];
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
  // Only the Super Admin pays money out (decided 2026-10-02); an Admin saves
  // the account as pending and the owner disburses it from its page.
  const ownerMayDisburse = canDisburse(me.role);
  const disbursesToday = disbursementDate === today && ownerMayDisburse;
  // A mid-term account is paid out of cash-in-hand too, net of what came back
  // before Rasi (decided 2026-10-03), so the form shows what is there.
  const books = useApiQuery(
    booksMoneyContract.getBooksOverview,
    manages && midTerm ? { query: {} } : null,
  );

  const [preview, setPreview] = useState<{
    key: string;
    result: AccountPreview | string;
  } | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);

  useEffect(() => {
    if (!previewKey || !customerId || !mayCreate) return;
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
  }, [previewKey, customerId, mayCreate]);

  if (!mayCreate) {
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
  // Given less collected; nothing once more than was given is back.
  const midTermTakes =
    midTerm &&
    current !== null &&
    typeof current !== "string" &&
    current.kind === "MID_TERM" &&
    MONEY_TEXT.test(investedText)
      ? ((net) => (isNegativeMoney(net) ? "0.00" : net))(
          subtractMoney(investedText, current.collectedAmount),
        )
      : null;
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
              <FormField
                name="collectionFrequency"
                label="Collection frequency"
                hint="How often the customer is collected from. It cannot be changed after disbursement."
              >
                <Select>
                  {COLLECTION_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {CADENCE[frequency].option}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="grid gap-[var(--stack-gap)] sm:grid-cols-2">
                <FormField name="dailyAmount" label={cadence.amount}>
                  <Input inputMode="decimal" autoComplete="off" data-numeric />
                </FormField>
                <FormField
                  name="termDays"
                  label={cadence.term}
                  rewrite={withRupees}
                >
                  <Input inputMode="numeric" autoComplete="off" data-numeric />
                </FormField>
              </div>
              <FormField
                name="disbursementDate"
                label="Disbursement date"
                hint={cadence.firstSlot}
              >
                <Input type="date" />
              </FormField>
              {midTerm && needsApproval ? (
                <FormMessage tone="warning">
                  An account that began before today is entered by an Admin.
                  Choose today or a later date.
                </FormMessage>
              ) : midTerm ? (
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
              {midTermTakes !== null && books.status === "ready" ? (
                <MidTermCash
                  held={books.data.officeCash}
                  takes={midTermTakes}
                  ownerMayAdd={ownerMayDisburse}
                />
              ) : null}

              <FormActions className="sm:flex-row-reverse sm:justify-start">
                {midTerm && needsApproval ? null : midTerm ? (
                  <SubmitButton value="create" pendingLabel="Saving…">
                    Save mid-term account
                  </SubmitButton>
                ) : needsApproval ? (
                  <SubmitButton value="create" pendingLabel="Sending…">
                    Send for approval
                  </SubmitButton>
                ) : (
                  <>
                    {/* "Save as pending" is first in the DOM, so Enter never
                        disburses: disbursing posts to the ledger and cannot be
                        undone. "Save and disburse" is moved to the end of the
                        row by `order`, not by its place in the markup. */}
                    <SubmitButton
                      tone={disbursesToday ? "secondary" : "primary"}
                      value="create"
                      pendingLabel="Saving…"
                    >
                      Save as pending
                    </SubmitButton>
                    {disbursesToday ? (
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
              {!midTerm && !disbursesToday ? (
                <p className="text-caption text-ink-muted">
                  {needsApproval
                    ? "Saved as pending and sent to an Admin to approve. Once approved, the Super Admin disburses it."
                    : ownerMayDisburse
                      ? "A future-dated account is saved as pending and disbursed on its day."
                      : "Saved as pending. The Super Admin disburses it from the account page, out of cash-in-hand."}
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
              frequency={cadenceOf(watched.collectionFrequency)}
              showAll={showAllSlots}
              onToggle={() => setShowAllSlots((all) => !all)}
            />
          )}
        </Section>
      </div>
    </>
  );
}

/**
 * What a mid-term account takes out of cash-in-hand, and what is left. The
 * API refuses it when short; this says so first, and tells the Super Admin
 * where to add money — an Admin cannot, so they are sent to the owner.
 */
function MidTermCash({
  held,
  takes,
  ownerMayAdd,
}: {
  held: string;
  takes: string;
  ownerMayAdd: boolean;
}) {
  const after = subtractMoney(held, takes);
  const short = !isZeroMoney(takes) && isNegativeMoney(after);

  return (
    <>
      <dl
        aria-label="Cash in hand"
        className="grid grid-cols-2 gap-3 rounded-control bg-surface-sunken px-4 py-3"
      >
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-ink-muted">Cash in hand now</dt>
          <dd className="text-heading text-ink" data-numeric>
            {signedAmount(held)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-ink-muted">After this account</dt>
          <dd
            className={
              short ? "text-heading text-critical" : "text-heading text-ink"
            }
            data-numeric
          >
            {signedAmount(after)}
          </dd>
        </div>
        <p className="col-span-2 text-caption text-ink-muted">
          {isZeroMoney(takes)
            ? "More than the amount given is already back, so this takes nothing from cash in hand."
            : `Takes ${formatCurrency(takes)}: the amount given, less what was collected before.`}
        </p>
      </dl>
      {short ? (
        <FormMessage
          tone="critical"
          action={
            ownerMayAdd ? (
              <Link
                href="/books/money?action=capital"
                className={buttonClass("secondary", undefined, "sm")}
              >
                Add money
              </Link>
            ) : undefined
          }
        >
          {ownerMayAdd
            ? "Not enough cash in hand for this account. Add money first."
            : "Not enough cash in hand for this account. Ask the owner to add money first."}
        </FormMessage>
      ) : null}
    </>
  );
}

function SchedulePreview({
  preview,
  accountAmount,
  frequency,
  showAll,
  onToggle,
}: {
  preview: AccountPreview;
  accountAmount: string;
  frequency: CollectionFrequency;
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
        <Stat label={midTerm ? "Collections left" : "Collections"}>
          {preview.slots.filter((slot) => slot.status === "PENDING").length}
        </Stat>
      </StatGrid>
      <p className="text-body text-ink-muted">
        {/* A daily account steps over a non-working day; a weekly or monthly
            one keeps its cadence and moves only the visit that lands on one. */}
        {frequency === "DAILY"
          ? preview.holidaysSkipped.length > 0
            ? `Skips ${holidayList(preview.holidaysSkipped)}, and every Sunday.`
            : "Sundays are skipped."
          : preview.holidaysSkipped.length > 0
            ? `A visit falling on a Sunday, or on ${holidayList(preview.holidaysSkipped)}, moves to the next working day; the visits after it keep their dates.`
            : "A visit falling on a Sunday or a holiday moves to the next working day; the visits after it keep their dates."}
      </p>
      <DataView
        caption="Collection slots"
        rows={showAll ? preview.slots : preview.slots.slice(0, SLOTS_SHOWN)}
        getRowId={(slot) => String(slot.sequence)}
        complete={false}
        columns={[
          valueColumn<Slot>({
            id: "day",
            header: frequency === "DAILY" ? "Day" : "Visit",
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
