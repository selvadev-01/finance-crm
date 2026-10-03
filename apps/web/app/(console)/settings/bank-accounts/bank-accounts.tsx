"use client";

import { Bank as BankIcon, Plus } from "@phosphor-icons/react/dist/ssr";
import { type BankAccountView, booksContract } from "@repo/contracts";
import {
  Button,
  Dialog,
  DialogActions,
  DialogForm,
  EmptyFrame,
  FilterBar,
  FormField,
  FormMessage,
  Input,
  ListSkeleton,
  NothingYet,
  NotPermitted,
  PageHeader,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { Money } from "../../../../components/money";
import { LoadFailed } from "../../../../components/query-state";
import { ActivityBadge } from "../../../../components/status-badge";
import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { isZeroMoney } from "../../../../lib/money";
import { canManageOrganisation, seesSettings } from "../../../../lib/roles";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { IconMark } from "../../books/visuals";
import { ShowInactiveToggle } from "../../_organisation/list-controls";

/**
 * Books (ADR-0018) · the business's bank accounts and what each holds. Admins
 * read them; only the Super Admin adds, renames and retires one — and not
 * while money is still in it.
 */
export function BankAccounts() {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const owner = seesSettings(me.role);
  const [showRetired, setShowRetired] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: "add" } | { kind: "edit" | "retire"; bank: BankAccountView } | null
  >(null);
  const banks = useApiQuery(
    booksContract.listBankAccounts,
    allowed
      ? { query: { includeRetired: showRetired ? "true" : "false" } }
      : null,
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
    banks.reload();
  };

  return (
    <>
      <PageHeader
        title="Bank accounts"
        description="Where the business keeps money outside the office. Money moves in and out of them from the ledger."
        actions={
          owner ? (
            <Button tone="primary" onClick={() => setDialog({ kind: "add" })}>
              Add bank account
            </Button>
          ) : null
        }
      />
      <FilterBar
        actions={
          <ShowInactiveToggle checked={showRetired} onChange={setShowRetired} />
        }
      />
      {banks.status === "loading" ? <ListSkeleton columns={3} /> : null}
      {banks.status === "error" ? (
        <LoadFailed message={banks.message} onRetry={banks.reload} />
      ) : null}
      {banks.status === "ready" ? (
        banks.data.data.length === 0 ? (
          <EmptyFrame>
            <NothingYet
              title="No bank accounts"
              description={
                owner
                  ? "Add the bank account the business uses, to record deposits and payments from it."
                  : "The owner adds the business's bank accounts."
              }
            />
          </EmptyFrame>
        ) : (
          <ul
            className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            aria-label="Bank accounts"
          >
            {banks.data.data.map((bank) => (
              <li
                key={bank.id}
                className="flex flex-col gap-4 rounded-surface border border-border bg-surface-raised p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex items-center gap-3">
                    <IconMark icon={BankIcon} />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium text-ink">{bank.name}</span>
                      <span className="text-caption text-ink-muted">
                        {bank.last4
                          ? `A/c no. ending ${bank.last4}`
                          : "No account number kept"}
                      </span>
                    </span>
                  </span>
                  <ActivityBadge isActive={bank.isActive} />
                </div>
                <div className="flex flex-col">
                  <span className="text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
                    Balance
                  </span>
                  <Money
                    amount={bank.balance}
                    className="text-title text-ink"
                  />
                </div>
                {owner ? (
                  <span className="mt-auto flex gap-2">
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: "edit", bank })}
                    >
                      Edit
                    </Button>
                    <Button
                      tone="secondary"
                      size="sm"
                      onClick={() => setDialog({ kind: "retire", bank })}
                    >
                      {bank.isActive ? "Retire" : "Bring back"}
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
            {owner ? (
              <li>
                <button
                  type="button"
                  onClick={() => setDialog({ kind: "add" })}
                  className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-surface border border-dashed border-border-strong text-label text-ink-muted transition-colors hover:border-accent hover:text-accent"
                >
                  <Plus aria-hidden size={20} />
                  Add a bank account
                </button>
              </li>
            ) : null}
          </ul>
        )
      ) : null}

      {dialog?.kind === "add" ? (
        <BankDialog onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === "edit" ? (
        <BankDialog
          bank={dialog.bank}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === "retire" ? (
        <RetireBankDialog
          bank={dialog.bank}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </>
  );
}

/** Add a bank, or correct one's name and last four digits. */
function BankDialog({
  bank,
  onClose,
  onDone,
}: {
  bank?: BankAccountView;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(booksContract.createBankAccount.body, {
    defaultValues: { name: bank?.name ?? "", last4: bank?.last4 ?? undefined },
  });
  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={bank ? `Edit ${bank.name}` : "Add a bank account"}
      description="Only the last four digits of the account number — never the whole number."
      submitLabel={bank ? "Save" : "Add bank account"}
      pendingLabel="Saving…"
      onSubmit={async (body) => {
        const result = bank
          ? await apiWrite(booksContract.updateBankAccount, {
              params: { bankAccountId: bank.id },
              body: { ...body, isActive: bank.isActive },
            })
          : await apiWrite(booksContract.createBankAccount, { body });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["name", "last4"],
          });
        }
        toast({ title: `${result.body.name} saved` });
        onDone();
      }}
    >
      <FormField
        name="name"
        label="Name"
        hint="How the business knows it — SBI Mylapore current account."
      >
        <Input autoComplete="off" maxLength={120} />
      </FormField>
      <FormField
        name="last4"
        label="Last four digits (optional)"
        valueAs="optional"
      >
        <Input inputMode="numeric" autoComplete="off" maxLength={4} />
      </FormField>
    </DialogForm>
  );
}

function RetireBankDialog({
  bank,
  onClose,
  onDone,
}: {
  bank: BankAccountView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const retiring = bank.isActive;
  const holdsMoney = retiring && !isZeroMoney(bank.balance);

  async function confirm() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(booksContract.updateBankAccount, {
      params: { bankAccountId: bank.id },
      body: {
        name: bank.name,
        last4: bank.last4 ?? undefined,
        isActive: !retiring,
      },
    });
    setPending(false);
    if (!result.ok) return setProblem(result.form ?? "Nothing was changed.");
    toast({
      title: retiring ? `${bank.name} retired` : `${bank.name} is back in use`,
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
      title={retiring ? `Retire ${bank.name}` : `Bring back ${bank.name}`}
      description={
        retiring
          ? "No money can be moved in or out of it. Its history stays in the books."
          : "Money can be moved in and out of it again."
      }
    >
      {holdsMoney ? (
        <FormMessage tone="warning">
          It still holds money. Move it out first — an account with money in it
          cannot be retired.
        </FormMessage>
      ) : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          aria-busy={pending || undefined}
          tone="primary"
          onClick={() => void confirm()}
          disabled={pending || holdsMoney}
        >
          {pending ? "Saving…" : retiring ? "Retire" : "Bring back"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
