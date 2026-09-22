"use client";

import {
  CalendarX,
  CheckCircle,
  Info,
  MapPin,
  Phone,
  Receipt,
} from "@phosphor-icons/react/dist/ssr";
import type { RouteView } from "@repo/contracts";
import {
  Button,
  cn,
  Dialog,
  Field,
  FormMessage,
  formatCurrency,
  Input,
  type InputProps,
  Textarea,
} from "@repo/ui";
import { useRef, useState } from "react";

import {
  amountProblem,
  type LocalRoute,
  subtractMoney,
} from "../../lib/offline/outbox";
import { cardClass, FieldPage } from "./app-chrome";
import { ClassificationMark, RowStateMark } from "./sync-marks";

type Customer = RouteView["customers"][number];
type Account = Customer["accounts"][number];

export type RecordAtDoor = (request: {
  account: Account;
  customer: Customer;
  amount: string;
  note: string;
}) => Promise<string | null>;

/**
 * J-02 · Record collection (S-02, US-041). The common case is one tap: the
 * amount is pre-filled with what is expected and the Junior confirms from the
 * sticky bar under their thumb. Saving never waits for the network — it is on
 * the phone before this screen changes (US-050).
 *
 * A customer with several accounts gets one card per account, each with its
 * own buttons, each confirmed on its own (BR-01a). "No payment" is its own
 * action, never a typed 0: it is the Junior asserting they were there (BR-09).
 */
export function CollectScreen({
  customerId,
  local,
  onRecord,
}: {
  customerId: string;
  local: LocalRoute | null;
  onRecord: RecordAtDoor;
}) {
  const customer = local?.route.customers.find(
    (candidate) => candidate.customerId === customerId,
  );

  return (
    <FieldPage
      back
      title={customer?.name ?? "Customer"}
      subtitle={
        customer ? (
          <span className="font-mono text-xs" data-numeric>
            {customer.customerCode}
          </span>
        ) : undefined
      }
      actions={
        customer ? (
          <a
            href={`tel:${customer.mobile}`}
            aria-label={`Call ${customer.name}`}
            className="flex size-12 items-center justify-center rounded-pill bg-accent-subtle text-accent"
          >
            <Phone aria-hidden size={22} weight="regular" />
          </a>
        ) : null
      }
      testId="collect"
    >
      {!customer || !local ? (
        <FormMessage tone="info">
          This customer is not on today’s route on this phone. Go back and
          refresh the route.
        </FormMessage>
      ) : (
        <>
          <div
            className={cn(cardClass, "flex flex-col divide-y divide-border")}
          >
            <p className="flex items-start gap-3 px-4 py-3 text-base text-ink">
              <MapPin
                aria-hidden
                size={20}
                weight="regular"
                className="mt-0.5 shrink-0 text-ink-muted"
              />
              {customer.address}
            </p>
            <a
              href={`tel:${customer.mobile}`}
              className="flex min-h-touch items-center gap-3 px-4 text-base font-medium text-accent"
              data-numeric
            >
              <Phone aria-hidden size={20} weight="regular" />
              {customer.mobile}
            </a>
          </div>
          {customer.accounts.length > 1 ? (
            <p className="flex items-start gap-3 rounded-surface border border-border bg-surface-sunken px-4 py-3 text-sm font-medium text-ink">
              <Info
                aria-hidden
                size={20}
                weight="regular"
                className="shrink-0 text-ink-muted"
              />
              {customer.accounts.length} accounts. Record each one separately —
              never put a combined payment against one account.
            </p>
          ) : null}
          {customer.accounts.map((account) => (
            <AccountForm
              key={account.accountLoanId}
              account={account}
              customer={customer}
              local={local}
              onRecord={onRecord}
              layout={customer.accounts.length > 1 ? "card" : "page"}
            />
          ))}
        </>
      )}
    </FieldPage>
  );
}

function AccountForm({
  account,
  customer,
  local,
  onRecord,
  layout,
}: {
  account: Account;
  customer: Customer;
  local: LocalRoute;
  onRecord: RecordAtDoor;
  /** `page`: the only account, its buttons in a sticky bar at the foot. */
  layout: "page" | "card";
}) {
  const [amount, setAmount] = useState(account.expectedAmount);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingNoPayment, setConfirmingNoPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const state = local.rowState[account.accountLoanId] ?? "PENDING";
  const typed = amount.replace(/[\s,₹]/g, "");
  // A typed 0 is not confirmable (it points to No payment), so it names no amount.
  const valid =
    amountProblem(typed, account.outstandingAmount) === null &&
    !/^0+(\.0+)?$/.test(typed);

  // Each record mints a new idempotency key, so a second tap would be a second
  // collection the server cannot tell apart. `saving` disables the buttons
  // only once React renders; this ref refuses a repeat at once, and stays
  // set until the route has re-read and the form is gone.
  const inFlight = useRef(false);

  async function save(value: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      setProblem(await onRecord({ account, customer, amount: value, note }));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function confirm() {
    const wrong = amountProblem(typed, account.outstandingAmount);
    if (wrong === "NOT_AN_AMOUNT") {
      setError("Enter the amount in rupees, like 100 or 100.50.");
    } else if (wrong === "EXCEEDS_OUTSTANDING") {
      setError(
        `More than the outstanding ${formatCurrency(account.outstandingAmount)}. Collect at most that.`,
      );
    } else if (/^0+(\.0+)?$/.test(typed)) {
      setError("For a visit where nothing was paid, use No payment.");
    } else {
      setError(null);
      void save(typed);
    }
  }

  const actions = (
    <>
      <Button
        tone="primary"
        onClick={confirm}
        disabled={saving}
        className="h-14 w-full rounded-pill text-lg font-semibold"
      >
        <CheckCircle aria-hidden size={22} weight="regular" />
        <span data-numeric>
          Confirm {valid ? formatCurrency(typed) : ""}
          {layout === "card" && valid ? (
            <span className="sr-only"> for {account.accountCode}</span>
          ) : null}
        </span>
      </Button>
      <Button
        tone="secondary"
        onClick={() => setConfirmingNoPayment(true)}
        disabled={saving}
        className="h-12 w-full rounded-pill border-critical-border text-critical shadow-none hover:bg-critical-subtle hover:text-critical"
      >
        <CalendarX aria-hidden size={20} weight="regular" />
        No payment — I visited
      </Button>
    </>
  );

  return (
    <section
      aria-labelledby={`${account.accountLoanId}-title`}
      className={cn(
        "flex flex-col gap-3",
        layout === "card" && cn(cardClass, "p-4"),
        layout === "page" && "flex-1",
      )}
      data-testid={`collect-${account.accountCode}`}
    >
      <div
        className={cn(
          "flex flex-col gap-3",
          layout === "page" && cn(cardClass, "p-4"),
        )}
      >
        <div className="flex min-h-9 items-center justify-between gap-2">
          <h2
            id={`${account.accountLoanId}-title`}
            className="flex items-center gap-2 font-mono text-base font-semibold text-ink"
            data-numeric
          >
            <Receipt
              aria-hidden
              size={20}
              weight="regular"
              className="shrink-0 text-ink-muted"
            />
            {account.accountCode}
          </h2>
          <RowStateMark state={state} />
        </div>

        <dl
          className="grid grid-cols-3 divide-x divide-border rounded-surface bg-surface-sunken py-3"
          data-numeric
        >
          <Figure
            label="Expected"
            value={formatCurrency(account.expectedAmount)}
          />
          <Figure
            label="Outstanding"
            value={formatCurrency(account.outstandingAmount)}
          />
          <Figure label="Days left" value={String(account.daysRemaining)} />
        </dl>
        <p className="text-sm text-ink-muted" data-numeric>
          Daily amount{" "}
          <span className="font-medium text-ink">
            {formatCurrency(account.dailyAmount)}
          </span>
        </p>

        {account.collectedToday ? (
          <p
            className="flex flex-wrap items-center gap-2 rounded-surface border border-border bg-surface-sunken px-3 py-3 text-base text-ink"
            data-testid="collected-today"
          >
            <CheckCircle
              aria-hidden
              size={22}
              weight="fill"
              className="shrink-0 text-positive"
            />
            Collected{" "}
            <span className="text-xl font-semibold" data-numeric>
              {account.collectedToday.classification === "NO_PAYMENT"
                ? "No payment"
                : formatCurrency(account.collectedToday.amount)}
            </span>
            <ClassificationMark
              classification={account.collectedToday.classification}
            />
          </p>
        ) : (
          <>
            <Field
              label="Amount collected (₹)"
              error={error ?? undefined}
              hint={varianceHint(typed, account.expectedAmount)}
              className={cn(
                "[&>label]:text-base [&>label]:font-medium",
                HINT_STRIP,
                HINT_TONE[
                  error
                    ? "critical"
                    : varianceTone(typed, account.expectedAmount)
                ],
              )}
            >
              <RupeeInput
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError(null);
                }}
              />
            </Field>
            <Field
              label="Note (optional)"
              hint="Only for something unusual."
              className="[&>label]:text-base"
            >
              <Textarea
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            {problem ? (
              <FormMessage tone="critical">{problem}</FormMessage>
            ) : null}
            {layout === "card" ? (
              <div className="flex flex-col gap-2">{actions}</div>
            ) : null}
          </>
        )}
      </div>

      {layout === "page" && !account.collectedToday ? (
        <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-surface-raised px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {actions}
        </div>
      ) : null}

      <Dialog
        open={confirmingNoPayment}
        onClose={() => setConfirmingNoPayment(false)}
        placement="sheet"
        title={`Record no payment from ${customer.name}`}
        description={`${account.accountCode}: you visited today and nothing was paid.`}
      >
        <p
          className="flex items-center justify-between rounded-surface bg-surface-sunken px-4 py-3 text-base text-ink-muted"
          data-numeric
        >
          Expected today
          <span className="font-semibold text-ink">
            {formatCurrency(account.expectedAmount)}
          </span>
        </p>
        <div className="flex flex-col gap-2 pb-2">
          <Button
            tone="danger"
            onClick={() => {
              setConfirmingNoPayment(false);
              void save("0");
            }}
            className="h-14 rounded-pill text-base font-semibold"
          >
            Record no payment
          </Button>
          <Button
            tone="ghost"
            onClick={() => setConfirmingNoPayment(false)}
            className="h-12 rounded-pill"
          >
            Cancel
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center">
      <dt className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-base font-semibold text-ink">{value}</dd>
    </div>
  );
}

/**
 * The amount field with a ₹ prefix — the largest thing on the screen, readable
 * in sunlight. `Field` gives its single child the id and aria props, so they
 * are passed straight on to the input: the label still names the input.
 */
function RupeeInput({ className, ...props }: InputProps) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-5 flex items-center text-3xl font-semibold text-ink-muted"
      >
        ₹
      </span>
      <Input
        {...props}
        className={cn(
          "h-18 rounded-surface border-2 pl-14 text-right text-4xl font-semibold focus:border-accent",
          className,
        )}
        data-numeric
      />
    </div>
  );
}

/** The hint under the amount as a tinted strip, toned by what it says. */
const HINT_STRIP =
  "[&>p]:flex [&>p]:min-h-10 [&>p]:items-center [&>p]:rounded-surface [&>p]:border [&>p]:px-3 [&>p]:py-2 [&>p]:text-sm [&>p]:font-medium";

const HINT_TONE = {
  none: "",
  positive:
    "[&>p]:border-positive-border [&>p]:bg-positive-subtle [&>p]:text-positive",
  warning:
    "[&>p]:border-warning-border [&>p]:bg-warning-subtle [&>p]:text-warning",
  info: "[&>p]:border-info-border [&>p]:bg-info-subtle [&>p]:text-info",
  critical:
    "[&>p]:border-critical-border [&>p]:bg-critical-subtle [&>p]:text-critical",
} as const;

/** The tone of `varianceHint`'s words — the same comparison, for colour only. */
function varianceTone(
  typed: string,
  expected: string,
): "none" | "positive" | "warning" | "info" {
  if (amountProblem(typed, "999999999999.99") !== null) return "none";
  const difference = subtractMoney(typed, expected);
  if (/^-?0\.00$/.test(difference)) return "positive";
  return difference.startsWith("-") ? "warning" : "info";
}

/** BR-08 in words while typing: exact, less or more — never a colour alone. */
function varianceHint(typed: string, expected: string): string | undefined {
  if (amountProblem(typed, "999999999999.99") !== null) return undefined;
  const difference = subtractMoney(typed, expected);
  if (/^-?0\.00$/.test(difference)) return "Exactly the expected amount.";
  return difference.startsWith("-")
    ? `${formatCurrency(difference.slice(1))} less than expected.`
    : `${formatCurrency(difference)} more than expected.`;
}
