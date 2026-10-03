"use client";

import {
  booksContract,
  booksMoneyContract,
  type Expense,
  organisationContract,
} from "@repo/contracts";
import {
  Button,
  DialogForm,
  FormField,
  formatBusinessDate,
  formatCurrency,
  Input,
  ListSkeleton,
  Section,
  Select,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { Money } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { apiWrite } from "../../../lib/api-write";
import { applyWriteFailure } from "../../../lib/form-errors";
import { useApiQuery } from "../../../lib/use-api-query";
import { CategoryIcon } from "../books/visuals";

/**
 * Field expenses waiting for a decision (ADR-0018, US-102): petrol and the
 * like, paid from collected cash. A Senior sees their line's and may record
 * their own, which goes to an Admin; an Admin sees every line's. Nobody is
 * offered to decide their own — the API refuses it regardless.
 */
export function FieldExpensesSection({
  canRequest,
  onChanged,
}: {
  /** A Senior on a line records their own here; a Junior uses the phone. */
  canRequest: boolean;
  onChanged: () => void;
}) {
  const pending = useApiQuery(booksMoneyContract.listExpenses, {
    query: { paidFrom: "CASH_IN_HAND", status: "PENDING", limit: 50 },
  });
  const [recording, setRecording] = useState(false);
  const changed = () => {
    pending.reload();
    onChanged();
  };

  return (
    <div id="field-expenses" className="scroll-mt-20">
      <Section
        title="Field expenses"
        description="Spent from collected cash on the round. Once approved, it comes off what the spender hands over."
        actions={
          canRequest ? (
            <Button tone="secondary" onClick={() => setRecording(true)}>
              Record field expense
            </Button>
          ) : null
        }
      >
        {pending.status === "loading" ? (
          <ListSkeleton columns={3} rows={2} />
        ) : null}
        {pending.status === "error" ? (
          <LoadFailed message={pending.message} onRetry={pending.reload} />
        ) : null}
        {pending.status === "ready" ? (
          pending.data.data.length === 0 ? (
            <p className="text-body text-ink-muted">
              No field expenses are waiting for a decision.
            </p>
          ) : (
            <ul
              className="flex flex-col gap-2"
              aria-label="Field expenses pending approval"
            >
              {pending.data.data.map((expense) => (
                <li key={expense.id}>
                  <FieldExpenseCard expense={expense} onDone={changed} />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Section>

      {recording ? (
        <RequestFieldExpenseDialog
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            changed();
          }}
        />
      ) : null}
    </div>
  );
}

/** Initials for a person's mark: "Selvi M" → "SM". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

/**
 * One field expense waiting (Stitch B-12): who spent it and when, what on —
 * the category with its icon and the note — the amount, and what approving
 * it changes, beside the decision.
 */
function FieldExpenseCard({
  expense,
  onDone,
}: {
  expense: Expense;
  onDone: () => void;
}) {
  const who = expense.spender?.name ?? "Staff";
  return (
    <article className="grid gap-3 rounded-surface border border-border bg-surface-raised p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-center">
      <span className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent-subtle text-label text-accent"
        >
          {initials(who)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">
            {who} · {expense.category.name}
          </span>
          <span className="text-caption text-ink-muted">
            {expense.line ? `${expense.line.name} · ` : ""}
            {formatBusinessDate(expense.businessDate)}
          </span>
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <CategoryIcon
          name={expense.category.name}
          className="shrink-0 text-ink-muted"
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-body text-ink">{expense.note}</span>
          <span className="text-caption text-ink-muted">
            {expense.canDecide
              ? `Approve, and ${who} hands over ${formatCurrency(expense.amount)} less.`
              : "Awaiting another approver."}
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-3 md:justify-end">
        <Money amount={expense.amount} className="text-title text-ink" />
        <ExpenseDecision expense={expense} onDone={onDone} />
      </span>
    </article>
  );
}

/**
 * Approve or reject one pending field expense — or, when the caller may not,
 * say who will. Approving posts it at once; rejecting needs a reason the
 * spender reads.
 */
export function ExpenseDecision({
  expense,
  onDone,
}: {
  expense: Expense;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  if (expense.status !== "PENDING") return null;
  if (!expense.canDecide) {
    return (
      <span className="text-caption text-ink-muted">
        Waiting for someone else to approve
      </span>
    );
  }

  async function approve() {
    setPending(true);
    const result = await apiWrite(booksMoneyContract.decideExpense, {
      params: { expenseId: expense.id },
      body: { decision: "APPROVED" },
    });
    setPending(false);
    if (!result.ok) {
      toast({
        title: "Not approved",
        description: result.form ?? "Try again.",
        tone: "critical",
      });
      return;
    }
    toast({
      title: `${formatCurrency(expense.amount)} ${expense.category.name.toLowerCase()} approved`,
      description: `${expense.spender?.name ?? "The spender"} hands over that much less.`,
    });
    onDone();
  }

  return (
    <>
      <Button
        tone="ghost"
        size="sm"
        onClick={() => setRejecting(true)}
        disabled={pending}
      >
        Reject
      </Button>
      <Button
        tone="primary"
        size="sm"
        onClick={() => void approve()}
        disabled={pending}
      >
        {pending ? "Approving…" : "Approve"}
      </Button>
      {rejecting ? (
        <RejectDialog
          expense={expense}
          onClose={() => setRejecting(false)}
          onDone={() => {
            setRejecting(false);
            onDone();
          }}
        />
      ) : null}
    </>
  );
}

function RejectDialog({
  expense,
  onClose,
  onDone,
}: {
  expense: Expense;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(booksMoneyContract.decideExpense.body, {
    defaultValues: { decision: "REJECTED", note: "" },
  });
  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Reject ${formatCurrency(expense.amount)} · ${expense.category.name}`}
      description={`${expense.spender?.name ?? "The spender"} still owes this cash and hands it over with the rest. A decision cannot be changed.`}
      submitLabel="Reject expense"
      pendingLabel="Rejecting…"
      onSubmit={async (body) => {
        const result = await apiWrite(booksMoneyContract.decideExpense, {
          params: { expenseId: expense.id },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["note"],
          });
        }
        toast({ title: "Expense rejected" });
        onDone();
      }}
    >
      <FormField
        name="note"
        label="Reason"
        hint="The spender reads this."
        valueAs="trimmed"
      >
        <Textarea maxLength={500} rows={2} />
      </FormField>
    </DialogForm>
  );
}

/** A Senior's own field expense, for an Admin to decide. */
function RequestFieldExpenseDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const categories = useApiQuery(booksContract.listExpenseCategories, {
    query: { includeRetired: "false" },
  });
  // A Senior's lines today: scoped by the API, so these are exactly theirs.
  const lines = useApiQuery(organisationContract.listLines, {
    query: { limit: 100 },
  });
  const form = useZodForm(booksMoneyContract.requestFieldExpense.body, {
    defaultValues: { categoryId: "", amount: "", note: "" },
  });
  const active =
    categories.status === "ready"
      ? categories.data.data.filter((category) => category.isActive)
      : [];
  // With one line the API knows which; with several (decided 2026-10-03) the
  // Senior says whose cash paid.
  const ownLines = lines.status === "ready" ? lines.data.data : [];
  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="Record a field expense"
      description="Paid from today's cash on your line. An Admin approves it, and then it comes off what you take to the office."
      submitLabel="Send for approval"
      pendingLabel="Sending…"
      onSubmit={async (body) => {
        const result = await apiWrite(booksMoneyContract.requestFieldExpense, {
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["categoryId", "amount", "note", "lineId"],
          });
        }
        toast({
          title: `${formatCurrency(result.body.amount)} sent for approval`,
        });
        onDone();
      }}
    >
      {ownLines.length > 1 ? (
        <FormField name="lineId" label="Line">
          <Select defaultValue="">
            <option value="" disabled>
              Choose the line
            </option>
            {ownLines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.code} · {line.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <FormField name="categoryId" label="Expense type">
        <Select>
          <option value="" disabled>
            Choose a category
          </option>
          {active.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField name="amount" label="Amount (₹)">
        <Input inputMode="decimal" autoComplete="off" />
      </FormField>
      <FormField name="note" label="Note" valueAs="trimmed">
        <Textarea maxLength={500} rows={2} />
      </FormField>
    </DialogForm>
  );
}
