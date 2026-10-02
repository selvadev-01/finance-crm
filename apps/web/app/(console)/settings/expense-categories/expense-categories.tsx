"use client";

import {
  booksContract,
  type ExpenseCategory,
  statementsContract,
} from "@repo/contracts";
import { startOfMonth, toBusinessDate } from "@repo/domain";
import {
  Button,
  cn,
  Dialog,
  DialogActions,
  DialogForm,
  EmptyFrame,
  FilterBar,
  FormField,
  FormMessage,
  formatCurrency,
  Input,
  ListSkeleton,
  NothingYet,
  NotPermitted,
  PageHeader,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { LoadFailed } from "../../../../components/query-state";
import { ActivityBadge } from "../../../../components/status-badge";
import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { canManageOrganisation, seesSettings } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { CategoryIcon } from "../../books/visuals";
import { ShowInactiveToggle } from "../../_organisation/list-controls";

/**
 * Books (ADR-0018) · what the business spends on. Admins read the list; only
 * the Super Admin adds, renames and retires a category. A category is never
 * deleted — its spending stays in the books under its name.
 */
export function ExpenseCategories() {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const owner = seesSettings(me.role);
  const [showRetired, setShowRetired] = useState(false);
  const [dialog, setDialog] = useState<
    | { kind: "add" }
    | { kind: "rename" | "retire"; category: ExpenseCategory }
    | null
  >(null);
  const categories = useApiQuery(
    booksContract.listExpenseCategories,
    allowed
      ? { query: { includeRetired: showRetired ? "true" : "false" } }
      : null,
  );

  // This month's spending per category, beside its card (Stitch B-13).
  const today = toBusinessDate(new Date());
  const month = useApiQuery(
    statementsContract.getProfitAndLoss,
    allowed ? { query: { from: startOfMonth(today), to: today } } : null,
  );
  const spentThisMonth = new Map(
    month.status === "ready"
      ? month.data.expenses.categories.map((each) => [
          each.categoryId,
          each.amount,
        ])
      : [],
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted />
      </EmptyFrame>
    );
  }

  const done = () => {
    setDialog(null);
    categories.reload();
  };

  return (
    <>
      <PageHeader
        title="Expense heads"
        description="What the business spends on. Every expense is filed under one, so the profit and loss can total them."
        actions={
          owner ? (
            <Button tone="primary" onClick={() => setDialog({ kind: "add" })}>
              Add expense head
            </Button>
          ) : null
        }
      />
      <FilterBar
        actions={
          <ShowInactiveToggle checked={showRetired} onChange={setShowRetired} />
        }
      />
      {categories.status === "loading" ? <ListSkeleton columns={2} /> : null}
      {categories.status === "error" ? (
        <LoadFailed message={categories.message} onRetry={categories.reload} />
      ) : null}
      {categories.status === "ready" ? (
        categories.data.data.length === 0 ? (
          <EmptyFrame>
            <NothingYet
              title="No expense heads"
              description="Add the first thing the business spends on."
            />
          </EmptyFrame>
        ) : (
          <ul
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Expense heads"
          >
            {categories.data.data.map((category) => {
              const spent = spentThisMonth.get(category.id);
              return (
                <li
                  key={category.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-4",
                    !category.isActive && "bg-surface-sunken",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-9 items-center justify-center rounded-pill",
                        category.isActive
                          ? "bg-accent-subtle text-accent"
                          : "bg-surface-raised text-ink-subtle",
                      )}
                    >
                      <CategoryIcon name={category.name} size={18} />
                    </span>
                    <ActivityBadge isActive={category.isActive} />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-ink">
                      {category.name}
                    </span>
                    <span className="text-caption text-ink-muted" data-numeric>
                      This month {formatCurrency(spent ?? "0.00")}
                    </span>
                  </div>
                  {owner ? (
                    <span className="mt-auto flex gap-2">
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: "rename", category })}
                      >
                        Rename
                      </Button>
                      <Button
                        tone="secondary"
                        size="sm"
                        onClick={() => setDialog({ kind: "retire", category })}
                      >
                        {category.isActive ? "Retire" : "Bring back"}
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {dialog?.kind === "add" ? (
        <AddCategoryDialog onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === "rename" ? (
        <RenameCategoryDialog
          category={dialog.category}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === "retire" ? (
        <RetireCategoryDialog
          category={dialog.category}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </>
  );
}

function AddCategoryDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(booksContract.createExpenseCategory.body, {
    defaultValues: { name: "" },
  });
  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="Add an expense head"
      submitLabel="Add expense head"
      pendingLabel="Adding…"
      onSubmit={async (body) => {
        const result = await apiWrite(booksContract.createExpenseCategory, {
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, { fields: ["name"] });
        }
        toast({ title: `${result.body.name} added` });
        onDone();
      }}
    >
      <FormField name="name" label="Name" hint="For example, Electricity.">
        <Input autoComplete="off" maxLength={120} />
      </FormField>
    </DialogForm>
  );
}

function RenameCategoryDialog({
  category,
  onClose,
  onDone,
}: {
  category: ExpenseCategory;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(booksContract.updateExpenseCategory.body, {
    defaultValues: { name: category.name, isActive: category.isActive },
  });
  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Rename ${category.name}`}
      description="Past expenses move to the new name with it."
      submitLabel="Save name"
      pendingLabel="Saving…"
      onSubmit={async (body) => {
        const result = await apiWrite(booksContract.updateExpenseCategory, {
          params: { categoryId: category.id },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, { fields: ["name"] });
        }
        toast({ title: `Renamed to ${result.body.name}` });
        onDone();
      }}
    >
      <FormField name="name" label="Name">
        <Input autoComplete="off" maxLength={120} />
      </FormField>
    </DialogForm>
  );
}

/** Names the consequence before anything changes (design-system.md rule 7). */
function RetireCategoryDialog({
  category,
  onClose,
  onDone,
}: {
  category: ExpenseCategory;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const retiring = category.isActive;

  async function confirm() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(booksContract.updateExpenseCategory, {
      params: { categoryId: category.id },
      body: { name: category.name, isActive: !retiring },
    });
    setPending(false);
    if (!result.ok) return setProblem(result.form ?? "Nothing was changed.");
    toast({
      title: retiring
        ? `${category.name} retired`
        : `${category.name} is back in use`,
    });
    onDone();
  }

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={
        retiring ? `Retire ${category.name}` : `Bring back ${category.name}`
      }
      description={
        retiring
          ? "No new expense can be filed under it. What was already spent stays in the books under this name."
          : "It can be chosen for new expenses again."
      }
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          tone="primary"
          onClick={() => void confirm()}
          disabled={pending}
        >
          {pending ? "Saving…" : retiring ? "Retire" : "Bring back"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
