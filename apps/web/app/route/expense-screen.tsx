"use client";

import {
  ArrowRight,
  CheckCircle,
  CloudSlash,
  Info,
} from "@phosphor-icons/react/dist/ssr";
import {
  booksContract,
  booksMoneyContract,
  cashContract,
  type CashPosition,
  type Expense,
  type ExpenseCategory,
  type RouteRequest,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  cn,
  Form,
  FormField,
  FormMessage,
  FormRootError,
  formatBusinessDate,
  formatCurrency,
  Input,
  Skeleton,
  Textarea,
  useZodForm,
} from "@repo/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useController, useFormState, useWatch } from "react-hook-form";

import { api } from "../../lib/api-client";
import { apiWrite } from "../../lib/api-write";
import { applyWriteFailure } from "../../lib/form-errors";
import { compareMoney, subtractMoney, sumMoney } from "../../lib/money";
import { CategoryIcon } from "../(console)/books/visuals";
import { Banner, cardClass, FieldPage, Section } from "./app-chrome";

type FieldExpenseRequest = RouteRequest<
  typeof booksMoneyContract.requestFieldExpense
>;

/** The footer's button sits outside the form, and submits it by this id. */
const FORM_ID = "field-expense";

/** Amounts a Junior spends most often: one tap instead of the keypad. */
const QUICK_AMOUNTS = ["20", "50", "100", "200"] as const;

/** Rupees with at most two decimals — anything else gets no preview. */
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * J-11 · A field expense (ADR-0018, US-102 on the Junior's phone) — petrol or
 * anything else paid from the cash collected on the round. It waits for the
 * Senior (or an Admin); once approved it comes off what the Junior hands
 * over, so it never shows as cash short.
 *
 * Laid out to the Stitch J-11 spec: icon tiles for what it was for, quick
 * amounts, and the handover it changes, read from today's cash position.
 *
 * **Needs signal**, like a correction: someone has to approve it, and an
 * expense waiting unseen on a phone would leave the count short with nobody
 * knowing why.
 */
export function ExpenseScreen({ connected }: { connected: boolean }) {
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [mine, setMine] = useState<Expense[] | null>(null);
  const [position, setPosition] = useState<CashPosition | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const form = useZodForm(booksMoneyContract.requestFieldExpense.body, {
    defaultValues: { categoryId: "", amount: "", note: "" },
  });
  const amount = useWatch({ control: form.control, name: "amount" }) ?? "";
  const saving = form.formState.isSubmitting;
  // A second tap must not ask twice.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const [listed, own, cash] = await Promise.all([
        api(booksContract.listExpenseCategories, {
          query: { includeRetired: "false" },
        }),
        api(booksMoneyContract.listExpenses, {
          query: { paidFrom: "CASH_IN_HAND", limit: 20 },
        }),
        // Only for the preview: the screen works without it.
        api(cashContract.getCashPosition, {}).catch(() => null),
      ]);
      if (listed.ok && own.ok) {
        setCategories(listed.body.data.filter((each) => each.isActive));
        setMine(own.body.data);
        setPosition(cash?.ok ? cash.body : null);
        setProblem(null);
      } else {
        setProblem("Could not load your expenses. Try again.");
      }
    } catch {
      setProblem("No signal. Connect to record an expense.");
    }
  }, []);

  useEffect(() => {
    // Reading the categories and the Junior's own expenses is the external
    // read this effect synchronises with; a tick keeps it out of the render.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, connected]);

  async function submit(body: FieldExpenseRequest["body"]) {
    if (inFlight.current) return;
    inFlight.current = true;
    const result = await apiWrite(booksMoneyContract.requestFieldExpense, {
      body,
    });
    inFlight.current = false;
    if (!result.ok) {
      return applyWriteFailure(form.setError, result, {
        fields: ["categoryId", "amount", "note"],
        fallback: "Not sent. Try again.",
      });
    }
    setSent(
      `${formatCurrency(result.body.amount)} for ${result.body.category.name.toLowerCase()} sent for approval.`,
    );
    form.reset();
    void load();
  }

  const offline = !connected && categories === null;

  return (
    <FieldPage
      back
      title="Field expense"
      testId="expense"
      footer={
        offline || !categories ? undefined : (
          <Button
            type="submit"
            form={FORM_ID}
            tone="primary"
            disabled={!connected || saving}
            className="h-13 w-full rounded-pill text-lg font-semibold"
          >
            {saving ? "Sending…" : "Send for approval"}
          </Button>
        )
      }
    >
      {offline ? (
        <Banner tone="warning" icon={<CloudSlash size={20} weight="regular" />}>
          No signal. An expense has to reach your Senior to be approved, so it
          cannot wait on the phone — your collections still save without signal.
        </Banner>
      ) : (
        <>
          <p className="flex items-start gap-3 rounded-surface border border-accent/20 bg-accent-subtle px-4 py-3 text-sm text-ink">
            <Info
              aria-hidden
              size={20}
              weight="regular"
              className="shrink-0 text-accent"
            />
            Expenses paid from collected cash. Approved expenses are deducted
            from your handover.
          </p>
          {sent ? (
            <p
              role="status"
              className="flex items-start gap-3 rounded-surface border border-positive-border bg-positive-subtle px-4 py-3 text-sm font-medium text-ink"
            >
              <CheckCircle
                aria-hidden
                size={20}
                weight="fill"
                className="shrink-0 text-positive"
              />
              {sent}
            </p>
          ) : null}
          {problem ? (
            <FormMessage tone="critical">{problem}</FormMessage>
          ) : null}
          {categories === null && !problem ? (
            <div
              role="status"
              aria-label="Loading"
              className="flex flex-col gap-2"
            >
              <Skeleton className="h-48 rounded-overlay" />
              <Skeleton className="h-32 rounded-overlay" />
            </div>
          ) : null}
          {categories ? (
            <Form
              id={FORM_ID}
              form={form}
              onSubmit={submit}
              className={cn(cardClass, "flex flex-col gap-5 p-4")}
            >
              <CategoryTiles categories={categories} />
              <div className="flex flex-col gap-2">
                <FormField
                  name="amount"
                  label="Amount (₹)"
                  rewrite={(message) =>
                    message.startsWith("must be an amount")
                      ? "Enter the amount in rupees, like 50 or 49.50."
                      : message
                  }
                >
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    className="h-14 text-2xl font-semibold"
                    data-numeric
                  />
                </FormField>
                <div
                  role="group"
                  aria-label="Quick amounts"
                  className="flex flex-wrap gap-2"
                >
                  {QUICK_AMOUNTS.map((quick) => (
                    <button
                      key={quick}
                      type="button"
                      aria-pressed={amount === quick}
                      onClick={() =>
                        form.setValue("amount", quick, {
                          shouldDirty: true,
                          shouldValidate: form.formState.isSubmitted,
                        })
                      }
                      className={cn(
                        "h-11 min-w-16 rounded-pill border px-4 text-sm font-medium transition-colors",
                        amount === quick
                          ? "border-accent bg-accent-subtle text-accent"
                          : "border-border bg-surface-raised text-ink",
                      )}
                      data-numeric
                    >
                      ₹{quick}
                    </button>
                  ))}
                </div>
              </div>
              <FormField
                name="note"
                label="Note"
                hint="“Petrol for the round”."
              >
                <Textarea rows={2} maxLength={500} />
              </FormField>
              <HandoverPreview position={position} amount={amount} />
              <FormRootError />
            </Form>
          ) : null}

          {mine && mine.length > 0 ? (
            <Section title="Field expenses">
              <ul
                className={cn(
                  cardClass,
                  "flex flex-col divide-y divide-border",
                )}
                aria-label="Field expenses"
              >
                {mine.map((expense) => (
                  <ExpenseRow key={expense.id} expense={expense} />
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </FieldPage>
  );
}

/**
 * What it was for: a grid of icon tiles, one radio each — the form's
 * `categoryId`. A radio group has no single control for a `<label>` to name,
 * so it is not a `FormControlField`; it names itself with `aria-labelledby`.
 */
function CategoryTiles({ categories }: { categories: ExpenseCategory[] }) {
  const { field } = useController<{ categoryId: string }, "categoryId">({
    name: "categoryId",
  });
  const { errors } = useFormState<{ categoryId: string }>({
    name: "categoryId",
  });
  const value = field.value;
  // The API's own word for this field (a retired type) is kept; the schema's
  // is only ever "nothing chosen".
  const error = errors.categoryId
    ? errors.categoryId.type === "server" && errors.categoryId.message
      ? errors.categoryId.message
      : "Choose an expense type."
    : undefined;
  return (
    <div className="flex flex-col gap-2">
      <span id="expense-what-for" className="text-sm font-medium text-ink">
        Expense type
      </span>
      <div
        role="radiogroup"
        aria-labelledby="expense-what-for"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "expense-what-for-error" : undefined}
        className="grid grid-cols-2 gap-2"
      >
        {categories.map((category, index) => {
          const selected = category.id === value;
          // The tile a failed submit focuses: the chosen one, else the first.
          const focusTarget = selected || (index === 0 && !value);
          return (
            <button
              key={category.id}
              ref={focusTarget ? field.ref : undefined}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => field.onChange(category.id)}
              className={cn(
                "flex min-h-16 items-center gap-2.5 rounded-surface border px-3 py-2.5 text-left text-sm transition-colors",
                selected
                  ? "border-accent bg-accent-subtle font-medium text-accent"
                  : error
                    ? "border-critical-border bg-surface-raised text-ink"
                    : "border-border bg-surface-raised text-ink",
              )}
            >
              <CategoryIcon
                name={category.name}
                size={24}
                className={cn(
                  "shrink-0",
                  selected ? "text-accent" : "text-ink-muted",
                )}
              />
              <span className="min-w-0">{category.name}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p id="expense-what-for-error" className="text-sm text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What approval changes: today's cash still to hand over, before and after.
 * Shown only when today's position is known and the amount reads as money.
 */
function HandoverPreview({
  position,
  amount,
}: {
  position: CashPosition | null;
  amount: string;
}) {
  const today = toBusinessDate(new Date());
  const items = (position?.items ?? []).filter(
    (item) => item.businessDate === today && item.hop === "JUNIOR_TO_SENIOR",
  );
  const trimmed = amount.trim();
  if (items.length === 0 || !MONEY.test(trimmed)) return null;
  const owed = sumMoney(items.map((item) => item.toHandOver));
  const spent = sumMoney([trimmed]);
  if (compareMoney(spent, "0.00") <= 0) return null;

  if (compareMoney(spent, owed) > 0) {
    return (
      <p className="rounded-surface border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-ink">
        That is more than the{" "}
        <span className="font-semibold" data-numeric>
          {formatCurrency(owed)}
        </span>{" "}
        you still hold for today. Check the amount.
      </p>
    );
  }
  return (
    <div
      role="note"
      aria-label="Handover after approval"
      className="flex flex-col gap-1.5 rounded-surface bg-surface-sunken px-4 py-3"
    >
      <span className="text-sm text-ink-muted">Handover after approval</span>
      <span className="flex flex-wrap items-center gap-2" data-numeric>
        <span className="text-base text-ink-muted line-through">
          {formatCurrency(owed)}
        </span>
        <ArrowRight aria-hidden size={16} className="text-ink-muted" />
        <span className="text-xl font-semibold text-ink">
          {formatCurrency(subtractMoney(owed, spent))}
        </span>
      </span>
    </div>
  );
}

function ExpenseRow({ expense }: { expense: Expense }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent-subtle">
        <CategoryIcon
          name={expense.category.name}
          size={20}
          className="text-accent"
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-base font-medium text-ink">
            {expense.category.name}
          </span>
          <span className="text-base font-semibold text-ink" data-numeric>
            {formatCurrency(expense.amount)}
          </span>
        </div>
        <span className="text-sm text-ink-muted" data-numeric>
          {formatBusinessDate(expense.businessDate)} · {expense.note}
        </span>
        <span>
          {expense.status === "APPROVED" ? (
            <Badge tone="positive">Approved</Badge>
          ) : expense.status === "REJECTED" ? (
            <Badge tone="critical">Rejected — hand it over</Badge>
          ) : (
            <Badge tone="warning">Waiting</Badge>
          )}
        </span>
        {expense.status === "REJECTED" && expense.decisionNote ? (
          <p className="text-sm text-critical">{expense.decisionNote}</p>
        ) : null}
      </div>
    </li>
  );
}
