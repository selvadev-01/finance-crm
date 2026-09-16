import { CaretLeft, Phone } from "@phosphor-icons/react/dist/ssr";
import type { RouteView } from "@repo/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  Field,
  FormMessage,
  formatCurrency,
  Input,
  Textarea,
} from "@repo/ui";
import { useRef, useState } from "react";

import {
  amountProblem,
  type LocalRoute,
  subtractMoney,
} from "../../lib/offline/outbox";
import { backToRoute } from "./hash-view";
import { RowStateMark } from "./sync-marks";

type Customer = RouteView["customers"][number];
type Account = Customer["accounts"][number];

export type RecordAtDoor = (request: {
  account: Account;
  customer: Customer;
  amount: string;
  note: string;
}) => Promise<string | null>;

const CLASSIFICATION = {
  CORRECT: { label: "As expected", tone: "positive" },
  LOW: { label: "Less than expected", tone: "warning" },
  EXTRA: { label: "More than expected", tone: "info" },
  NO_PAYMENT: { label: "No payment", tone: "critical" },
} as const;

/**
 * S-02 · Record collection. The common case is one tap: the amount is
 * pre-filled with what is expected and the Junior confirms. Saving never waits
 * for the network — it is on the phone before this screen changes (US-050).
 *
 * A customer with several accounts gets one form per account, each confirmed
 * on its own (BR-01a). "No payment" is its own action, never a typed 0: it is
 * the Junior asserting they were there (BR-09).
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
    <div className="flex flex-col gap-[var(--stack-gap)]" data-testid="collect">
      <div>
        <Button tone="ghost" onClick={backToRoute} className="-ml-3">
          <CaretLeft aria-hidden size={20} weight="regular" />
          Route
        </Button>
      </div>

      {!customer || !local ? (
        <FormMessage tone="info">
          This customer is not on today’s route on this phone. Go back and
          refresh the route.
        </FormMessage>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-ink">{customer.name}</h1>
            <p className="text-sm text-ink-muted">{customer.address}</p>
            <a
              href={`tel:${customer.mobile}`}
              className="flex min-h-[var(--control-height)] w-fit items-center gap-1.5 text-sm font-medium text-accent"
            >
              <Phone aria-hidden size={16} weight="regular" />
              {customer.mobile}
            </a>
          </div>
          {customer.accounts.length > 1 ? (
            <FormMessage tone="info">
              {customer.accounts.length} accounts. Record each one separately —
              never put a combined payment against one account.
            </FormMessage>
          ) : null}
          {customer.accounts.map((account) => (
            <AccountForm
              key={account.accountLoanId}
              account={account}
              customer={customer}
              local={local}
              onRecord={onRecord}
            />
          ))}
        </>
      )}
    </div>
  );
}

function AccountForm({
  account,
  customer,
  local,
  onRecord,
}: {
  account: Account;
  customer: Customer;
  local: LocalRoute;
  onRecord: RecordAtDoor;
}) {
  const [amount, setAmount] = useState(account.expectedAmount);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingNoPayment, setConfirmingNoPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const state = local.rowState[account.accountLoanId] ?? "PENDING";
  const typed = amount.replace(/[\s,₹]/g, "");

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

  return (
    <section
      aria-labelledby={`${account.accountLoanId}-title`}
      className="flex flex-col gap-[var(--stack-gap)] rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4"
      data-testid={`collect-${account.accountCode}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={`${account.accountLoanId}-title`}
          className="text-sm font-medium text-ink-muted"
        >
          {account.accountCode}
        </h2>
        <RowStateMark state={state} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2" data-numeric>
        <Figure
          label="Expected today"
          value={formatCurrency(account.expectedAmount)}
          size="large"
        />
        <Figure
          label="Outstanding"
          value={formatCurrency(account.outstandingAmount)}
        />
        <Figure
          label="Daily amount"
          value={formatCurrency(account.dailyAmount)}
        />
        <Figure label="Days remaining" value={String(account.daysRemaining)} />
      </dl>

      {account.collectedToday ? (
        <p
          className="flex flex-wrap items-center gap-2 text-base text-ink"
          data-testid="collected-today"
        >
          Collected{" "}
          <span className="font-semibold" data-numeric>
            {formatCurrency(account.collectedToday.amount)}
          </span>
          <Badge
            tone={CLASSIFICATION[account.collectedToday.classification].tone}
          >
            {CLASSIFICATION[account.collectedToday.classification].label}
          </Badge>
        </p>
      ) : (
        <>
          <Field
            label="Amount collected (₹)"
            error={error ?? undefined}
            hint={varianceHint(typed, account.expectedAmount)}
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(null);
              }}
              className="text-lg font-semibold"
              data-numeric
            />
          </Field>
          <Field label="Note (optional)" hint="Only for something unusual.">
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
          <div className="flex flex-col gap-2">
            <Button tone="primary" onClick={confirm} disabled={saving}>
              Confirm{" "}
              {amountProblem(typed, account.outstandingAmount) === null
                ? formatCurrency(typed)
                : ""}
            </Button>
            <Button
              tone="secondary"
              onClick={() => setConfirmingNoPayment(true)}
              disabled={saving}
            >
              No payment — I visited
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={confirmingNoPayment}
        onClose={() => setConfirmingNoPayment(false)}
        title={`Record no payment from ${customer.name}`}
        description={`${account.accountCode}: you visited today and nothing was paid.`}
      >
        <DialogActions>
          <Button
            tone="secondary"
            onClick={() => setConfirmingNoPayment(false)}
          >
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={() => {
              setConfirmingNoPayment(false);
              void save("0");
            }}
          >
            Record no payment
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}

function Figure({
  label,
  value,
  size = "normal",
}: {
  label: string;
  value: string;
  size?: "normal" | "large";
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={
          size === "large"
            ? "text-lg font-semibold text-ink"
            : "text-base text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
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
