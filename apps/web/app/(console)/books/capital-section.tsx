"use client";

import { capitalContract } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Button,
  Card,
  DialogForm,
  FormField,
  formatBusinessDate,
  formatCurrency,
  Input,
  ListSkeleton,
  NothingYet,
  Section,
  Stat,
  StatGrid,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { Money } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { apiWrite } from "../../../lib/api-write";
import { applyWriteFailure } from "../../../lib/form-errors";
import { Pager } from "../../../components/pager";
import { absMoney, isNegativeMoney } from "../../../lib/money";
import { usePagedQuery } from "../../../lib/use-paged-query";

/**
 * US-032 · money the owner puts into the business, on Books (moved from Cash
 * on 2026-10-02). Admins read it (it is ledger money, `ledger.view`); only
 * the Super Admin records it (`capital.add`) — the API refuses anyone else
 * regardless. Each entry funds cash-in-hand, and a loan is paid out only from
 * cash-in-hand: `INSUFFICIENT_CASH_IN_HAND` otherwise (decided 2026-10-02) —
 * a mid-term account too, net of what came back before (2026-10-03).
 */
export function CapitalSection({
  canAdd,
  startAdding = false,
  onChanged,
}: {
  canAdd: boolean;
  /** Opened from the disburse dialog's "Add money" (`?action=capital`). */
  startAdding?: boolean;
  onChanged?: () => void;
}) {
  const capital = usePagedQuery(capitalContract.listCapital, { query: {} });
  const [adding, setAdding] = useState(canAdd && startAdding);

  return (
    <Section
      title="Money added by owner"
      description="Money the owner puts into the business. Loans are given out of it."
      actions={
        canAdd ? (
          <Button tone="primary" onClick={() => setAdding(true)}>
            Add money
          </Button>
        ) : null
      }
    >
      {capital.status === "loading" ? (
        <ListSkeleton columns={3} rows={2} />
      ) : null}
      {capital.status === "error" ? (
        <LoadFailed message={capital.message} onRetry={capital.reload} />
      ) : null}
      {capital.status === "ready" ? (
        <>
          <StatGrid columns={2}>
            <Stat
              label="Cash in hand"
              tone={
                isNegativeMoney(capital.data.officeCash)
                  ? "critical"
                  : "neutral"
              }
              hint={
                isNegativeMoney(capital.data.officeCash)
                  ? "More has been paid out than put in."
                  : undefined
              }
            >
              {balance(capital.data.officeCash)}
            </Stat>
            <Stat label="Total added">
              {formatCurrency(capital.data.totalCapital)}
            </Stat>
          </StatGrid>
          {capital.rows.length === 0 ? (
            <NothingYet
              title="No money added yet"
              description="Add the money you put into the business. Loans are given only from it."
              action={
                canAdd ? (
                  <Button tone="primary" onClick={() => setAdding(true)}>
                    Add money
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {capital.rows.map((entry) => (
                <li key={entry.id}>
                  <Card.Root>
                    <Card.Body className="flex-row flex-wrap items-center justify-between gap-3 py-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium text-ink">
                          {entry.note}
                        </span>
                        <span className="text-caption text-ink-muted">
                          {formatBusinessDate(entry.businessDate)}
                          {entry.addedBy ? ` · by ${entry.addedBy.name}` : ""}
                        </span>
                      </span>
                      <Money amount={entry.amount} className="text-ink" />
                    </Card.Body>
                  </Card.Root>
                </li>
              ))}
            </ul>
          )}
          {capital.rows.length > 0 ? (
            <Pager list={capital} noun="entries" nounSingular="entry" />
          ) : null}
        </>
      ) : null}

      {adding ? (
        <AddCapitalDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            capital.reload();
            onChanged?.();
          }}
        />
      ) : null}
    </Section>
  );
}

/** A balance below zero, with a true minus sign (U+2212) like every signed figure. */
function balance(amount: string): string {
  return isNegativeMoney(amount)
    ? `−${formatCurrency(absMoney(amount))}`
    : formatCurrency(amount);
}

/**
 * Validated against the contract's own body. An entry is never edited, so the
 * dialog says so before it is saved (design-system.md rule 7).
 */
function AddCapitalDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const today = toBusinessDate(new Date());
  const form = useZodForm(capitalContract.addCapital.body, {
    defaultValues: { amount: "", businessDate: undefined, note: "" },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="Add money"
      description="Cash in hand goes up by this amount. An entry cannot be changed later — a mistake is put right with another entry."
      submitLabel="Add money"
      pendingLabel="Adding…"
      onSubmit={async (body) => {
        const result = await apiWrite(capitalContract.addCapital, { body });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["amount", "businessDate", "note"],
          });
        }
        toast({
          title: `${formatCurrency(result.body.amount)} added`,
          description: formatBusinessDate(result.body.businessDate),
        });
        onAdded();
      }}
    >
      <FormField name="amount" label="Amount (₹)">
        <Input inputMode="decimal" autoComplete="off" />
      </FormField>
      <FormField
        name="businessDate"
        label="Received on"
        hint="Leave blank for today. Never a future date."
        valueAs="optional"
      >
        <Input type="date" max={today} />
      </FormField>
      <FormField
        name="note"
        label="Note"
        hint="Where it came from — “owner’s savings”, “gold loan”."
        valueAs="trimmed"
      >
        <Textarea maxLength={500} rows={2} />
      </FormField>
    </DialogForm>
  );
}
