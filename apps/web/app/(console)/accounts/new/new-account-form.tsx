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
  DataTable,
  Field,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Input,
  NotPermitted,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { api } from "../../../../lib/api-client";
import { apiWrite } from "../../../../lib/api-write";
import { canManageOrganisation } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { LIST_LIMIT, RecordNotFound, Surface } from "../../_organisation/list-controls";

type TermsField =
  | "accountAmount"
  | "investedAmount"
  | "dailyAmount"
  | "termDays"
  | "disbursementDate"
  | "collectedToDate";

type Values = Record<TermsField, string>;
type Errors = Partial<Record<TermsField, string>>;

const LABEL: Record<TermsField, string> = {
  accountAmount: "Account amount",
  investedAmount: "Invested amount",
  dailyAmount: "Daily amount",
  termDays: "Term",
  disbursementDate: "Disbursement date",
  collectedToDate: "Collected to date",
};

const SLOTS_SHOWN = 12;

/** The contract's own checks, as sentences under each field (S-04 error state). */
/** What is sent: collected to date only for a past date (US-030a). */
function requestTerms(values: Values, today: string) {
  const { collectedToDate, ...terms } = values;
  return values.disbursementDate && values.disbursementDate < today
    ? { ...terms, collectedToDate }
    : terms;
}

function check(values: Values, today: string): { errors: Errors; ok: boolean } {
  const errors: Errors = {};
  const midTerm = Boolean(values.disbursementDate) && values.disbursementDate < today;
  if (midTerm && values.collectedToDate.trim() === "") {
    errors.collectedToDate =
      "Enter what the customer has paid so far — 0 if nothing yet.";
  }
  const parsed = accountTermsSchema.safeParse(requestTerms(values, today));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as TermsField;
      if (errors[field] || !(field in LABEL)) continue;
      errors[field] =
        field === "termDays" && issue.message.includes("cannot clear")
          ? `${issue.message.replace(/^(\S+)/, "₹$1").replace("clear ", "clear ₹")}.`
          : `${LABEL[field]} ${issue.message}.`;
    }
  }
  return { errors, ok: Object.keys(errors).length === 0 };
}

/**
 * S-04 · US-030. Every derived value is visible before saving, because the
 * amounts cannot change after disbursement: profit updates as you type (it is
 * `A − I`, computed here in paise), and once the terms are valid the API's
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

  const [values, setValues] = useState<Values>({
    accountAmount: "",
    investedAmount: "",
    dailyAmount: "",
    termDays: "100",
    disbursementDate: today,
    collectedToDate: "",
  });
  const [touched, setTouched] = useState<Partial<Record<TermsField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [preview, setPreview] = useState<{ key: string; result: AccountPreview | string } | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { errors, ok } = check(values, today);
  const previewKey = JSON.stringify(requestTerms(values, today));
  const midTerm = values.disbursementDate !== "" && values.disbursementDate < today;

  useEffect(() => {
    if (!ok || !customerId || !manages) return;
    let cancelled = false;
    // Debounced: a preview per settled value, not per keystroke.
    const timer = setTimeout(() => {
      api(accountContract.previewAccount, { body: { customerId, ...JSON.parse(previewKey) } })
        .then((result) => {
          if (cancelled) return;
          setPreview({
            key: previewKey,
            result: result.ok
              ? result.body
              : (result.body?.message ?? "The schedule couldn’t be worked out just now."),
          });
        })
        .catch(() => {
          if (!cancelled) setPreview({ key: previewKey, result: "Could not reach Rasi to work out the schedule." });
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ok, previewKey, customerId, manages]);

  if (!manages) {
    return (
      <Surface>
        <NotPermitted />
      </Surface>
    );
  }
  if (!customerId || customer.status === "not-found" || customer.status === "not-permitted") {
    return <RecordNotFound noun="Customer" />;
  }

  const shownError = (field: TermsField) =>
    touched[field] || submitted ? errors[field] : undefined;
  const set = (field: TermsField) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const blur = (field: TermsField) => () =>
    setTouched((current) => ({ ...current, [field]: true }));

  // P = A − I, live, in paise — never a floating-point number (BR-11).
  const profit = (() => {
    const a = /^\d{1,12}(\.\d{1,2})?$/.test(values.accountAmount.replace(/[\s,]/g, ""));
    const i = /^\d{1,12}(\.\d{1,2})?$/.test(values.investedAmount.replace(/[\s,]/g, ""));
    if (!a || !i) return null;
    const paise = (value: string) => {
      const [rupees = "0", fraction = ""] = value.replace(/[\s,]/g, "").split(".");
      return BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));
    };
    const p = paise(values.accountAmount) - paise(values.investedAmount);
    const sign = p < 0n ? "-" : "";
    const abs = p < 0n ? -p : p;
    return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
  })();

  const current = preview && preview.key === previewKey && ok ? preview.result : null;
  const canDisburse = values.disbursementDate === today;
  const collectedField =
    touched.collectedToDate || submitted ? errors.collectedToDate : undefined;

  async function save(disburse: boolean) {
    setSubmitted(true);
    if (!ok) {
      document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      return;
    }
    setPending(true);
    setProblem(null);
    const result = await apiWrite(accountContract.createAccount, {
      body: { customerId, ...requestTerms(values, today), disburse },
    });
    setPending(false);
    if (!result.ok) {
      setProblem(result.form ?? result.details.map((detail) => `${detail.field} ${detail.issue}`).join(". "));
      return;
    }
    router.push(`/accounts/${result.body.id}`);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(false);
  }

  const activeCount = existing.status === "ready" ? existing.data.data.length : 0;

  return (
    <>
      <PageHeader
        eyebrow={
          customer.status === "ready" ? (
            <Link href={`/customers/${customerId}`} className="hover:text-ink hover:underline">
              {customer.data.name} · {customer.data.customerCode}
            </Link>
          ) : (
            "Customer"
          )
        }
        title="New account"
        description="Amounts cannot be changed after disbursement. Check the schedule before saving."
      />

      {activeCount > 0 ? (
        <FormMessage tone="info">
          This customer already has {activeCount} active account{activeCount === 1 ? "" : "s"}. A
          further account is allowed; each keeps its own schedule and balance.
        </FormMessage>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <form onSubmit={submit} noValidate className="flex flex-col gap-[var(--stack-gap)]">
          {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
          <fieldset disabled={pending} className="flex flex-col gap-[var(--stack-gap)]">
            <Field label="Account amount (₹)" hint="What the customer repays in total." error={shownError("accountAmount")}>
              <Input inputMode="decimal" autoComplete="off" autoFocus value={values.accountAmount} onChange={set("accountAmount")} onBlur={blur("accountAmount")} />
            </Field>
            <Field label="Invested amount (₹)" hint="The cash handed to the customer." error={shownError("investedAmount")}>
              <Input inputMode="decimal" autoComplete="off" value={values.investedAmount} onChange={set("investedAmount")} onBlur={blur("investedAmount")} />
            </Field>
            <div className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2">
              <span className="text-sm font-medium text-ink">Profit</span>
              <span className="text-base font-semibold text-ink" data-numeric aria-live="polite">
                {profit === null ? "—" : profit.startsWith("-") ? "Not positive" : formatCurrency(profit)}
              </span>
              <span className="text-2xs text-ink-muted">Account amount − invested amount. Not editable.</span>
            </div>
            <div className="grid gap-[var(--stack-gap)] sm:grid-cols-2">
              <Field label="Daily amount (₹)" error={shownError("dailyAmount")}>
                <Input inputMode="decimal" autoComplete="off" value={values.dailyAmount} onChange={set("dailyAmount")} onBlur={blur("dailyAmount")} />
              </Field>
              <Field label="Term (days)" error={shownError("termDays")}>
                <Input inputMode="numeric" autoComplete="off" value={values.termDays} onChange={set("termDays")} onBlur={blur("termDays")} />
              </Field>
            </div>
            <Field label="Disbursement date" hint="Day 0 — collection starts the next working day." error={shownError("disbursementDate")}>
              <Input type="date" value={values.disbursementDate} onChange={set("disbursementDate")} onBlur={blur("disbursementDate")} />
            </Field>
            {midTerm ? (
              <div className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-warning/40 bg-warning-subtle p-3">
                <p className="text-sm font-medium text-ink">
                  A past date makes this a mid-term account: already disbursed, and collected partway.
                </p>
                <Field
                  label="Collected to date (₹)"
                  hint="Everything paid up to and including today. Take it from the customer's collection note — never days × daily amount: one underpayment makes that wrong, and the account would finish early with money uncollected."
                  error={collectedField}
                >
                  <Input inputMode="decimal" autoComplete="off" value={values.collectedToDate} onChange={set("collectedToDate")} onBlur={blur("collectedToDate")} />
                </Field>
              </div>
            ) : null}
          </fieldset>

          {midTerm ? (
          <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse sm:justify-start">
            <Button tone="primary" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save mid-term account"}
            </Button>
            <Link href={`/customers/${customerId}`} className="self-center px-2 text-sm text-ink-muted hover:text-ink hover:underline">
              Cancel
            </Link>
          </div>
          ) : (
          <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse sm:justify-start">
            <Button
              tone="primary"
              onClick={() => void save(true)}
              disabled={pending || !canDisburse}
              title={canDisburse ? undefined : "Only an account dated today can be disbursed now"}
            >
              {pending ? "Saving…" : "Save and disburse"}
            </Button>
            <Button tone="secondary" type="submit" disabled={pending}>
              Save as pending
            </Button>
            <Link href={`/customers/${customerId}`} className="self-center px-2 text-sm text-ink-muted hover:text-ink hover:underline">
              Cancel
            </Link>
          </div>
          )}
          {!midTerm && !canDisburse ? (
            <p className="text-sm text-ink-muted">
              A future-dated account is saved as pending and disbursed on its day.
            </p>
          ) : null}
        </form>

        <section aria-labelledby="schedule-preview" aria-live="polite" className="flex min-w-0 flex-col gap-3">
          <h2 id="schedule-preview" className="text-base font-semibold text-ink">
            Schedule preview
          </h2>
          {!ok ? (
            <p className="text-sm text-ink-muted">
              Enter valid amounts, a term and a date to see every collection slot.
            </p>
          ) : current === null ? (
            <p className="text-sm text-ink-muted" role="status">Working out the schedule…</p>
          ) : typeof current === "string" ? (
            <FormMessage tone="critical">{current}</FormMessage>
          ) : (
            <>
              {current.kind === "MID_TERM" ? (
                <dl className="grid gap-3 sm:grid-cols-3">
                  <PreviewFigure label="Collected so far">{formatCurrency(current.collectedAmount)}</PreviewFigure>
                  <PreviewFigure label="Outstanding">{formatCurrency(current.outstandingAmount)}</PreviewFigure>
                  <PreviewFigure label="Behind schedule">
                    {current.amountBehind === "0.00" ? "Not behind" : formatCurrency(current.amountBehind)}
                  </PreviewFigure>
                </dl>
              ) : null}
              <dl className="grid gap-3 sm:grid-cols-3">
                <PreviewFigure label="First collection">{formatBusinessDate(current.firstCollectionDate)}</PreviewFigure>
                <PreviewFigure label="Target completion">{formatBusinessDate(current.targetCompletionDate)}</PreviewFigure>
                <PreviewFigure label={current.kind === "MID_TERM" ? "Collection days left" : "Collection days"}>
                  {current.slots.filter((slot) => slot.status === "PENDING").length}
                </PreviewFigure>
              </dl>
              {current.holidaysSkipped.length > 0 ? (
                <p className="text-sm text-ink-muted">
                  Skips {current.holidaysSkipped.map((holiday) => `${holiday.name} (${formatBusinessDate(holiday.date)})`).join(", ")}, and every Sunday.
                </p>
              ) : (
                <p className="text-sm text-ink-muted">Sundays are skipped.</p>
              )}
              <DataTable
                caption="Collection slots"
                rows={showAllSlots ? current.slots : current.slots.slice(0, SLOTS_SHOWN)}
                rowKey={(slot) => String(slot.sequence)}
                columns={[
                  { header: "Day", align: "end", cell: (slot) => slot.sequence },
                  { header: "Date", cell: (slot) => formatBusinessDate(slot.dueDate) },
                  { header: "Expected", align: "end", cell: (slot) => formatCurrency(slot.expectedAmount) },
                  ...(current.kind === "MID_TERM"
                    ? [
                        {
                          header: "Status",
                          align: "end" as const,
                          cell: (slot: (typeof current.slots)[number]) =>
                            slot.status === "COLLECTED"
                              ? "Paid before Rasi"
                              : slot.status === "PARTIAL"
                                ? "Part paid"
                                : "To collect",
                        },
                      ]
                    : []),
                ]}
              />
              {current.slots.length > SLOTS_SHOWN ? (
                <div>
                  <Button tone="ghost" onClick={() => setShowAllSlots((all) => !all)}>
                    {showAllSlots ? "Show fewer" : `Show all ${current.slots.length} slots`}
                  </Button>
                </div>
              ) : null}
              <p className="text-sm text-ink" data-numeric>
                {current.kind === "MID_TERM"
                  ? `Collection in Rasi starts ${formatBusinessDate(current.slots.find((slot) => slot.status === "PENDING")!.dueDate)}; the remaining slots add up to exactly ${formatCurrency(current.outstandingAmount)}.`
                  : `The last slot expects ${formatCurrency(current.slots.at(-1)!.expectedAmount)}; the slots add up to exactly ${formatCurrency(toTwoPlaces(values.accountAmount))}.`}
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function toTwoPlaces(value: string): string {
  const [rupees = "0", fraction = ""] = value.replace(/[\s,]/g, "").split(".");
  return `${rupees}.${fraction.padEnd(2, "0")}`;
}

function PreviewFigure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3">
      <dt className="text-2xs font-medium tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="text-base font-semibold text-ink" data-numeric>{children}</dd>
    </div>
  );
}
