"use client";

import {
  ArrowRight,
  ArrowsDownUp,
  ArrowsLeftRight,
  Coins,
  HandCoins,
  Info,
} from "@phosphor-icons/react/dist/ssr";
import {
  type BankAccountView,
  booksMoneyContract,
  type MoneyMovement,
} from "@repo/contracts";
import { startOfMonth, toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  cn,
  DialogForm,
  EmptyFrame,
  FormField,
  formatBusinessDate,
  formatCurrency,
  Input,
  ListSkeleton,
  NothingYet,
  NotPermitted,
  PageHeader,
  Section,
  Select,
  Stat,
  StatGrid,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import { type ReactNode, useState } from "react";
import { useWatch } from "react-hook-form";

import { Pager } from "../../../../components/pager";
import { LoadFailed } from "../../../../components/query-state";
import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { addMoney, subtractMoney } from "../../../../lib/money";
import {
  canAddCapital,
  canManageOrganisation,
  seesSettings,
} from "../../../../lib/roles";
import { BOOKS_SIMPLE } from "../../../../lib/books-mode";
import { CapitalSection } from "../capital-section";
import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import { activeBanks, OFFICE_CASH, PlaceField, useBanks } from "../books-parts";
import { IconMark, signedAmount } from "../visuals";

type Kind = "transfer" | "income" | "drawing";

const LISTS = {
  transfer: {
    route: booksMoneyContract.listBankTransfers,
    label: "Contra",
    noun: ["transfers", "transfer"],
    empty: "No contra entries yet.",
  },
  income: {
    route: booksMoneyContract.listOtherIncome,
    label: "Other income",
    noun: ["entries", "entry"],
    empty: "No other receipts yet.",
  },
  drawing: {
    route: booksMoneyContract.listDrawings,
    label: "Owner took out",
    noun: ["drawings", "drawing"],
    empty: "No drawings yet.",
  },
} as const;

/**
 * Books · bank, income and drawings (ADR-0018, US-103 and US-104; Stitch
 * B-04): three things to do, what the month moved, and every movement drawn
 * as where the money came from → where it went. Admins move money and record
 * income; drawings are the owner's alone. Nothing is ever edited.
 */
export function MoneyMovements({
  startAction,
  startCapital = false,
}: {
  /** Opened from a quick action on the Books overview. */
  startAction?: Kind | undefined;
  /** `?action=capital`, from the disburse dialog when cash-in-hand is short. */
  startCapital?: boolean;
}) {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const owner = seesSettings(me.role);
  const banks = useBanks(allowed);
  const today = toBusinessDate(new Date());
  const monthFrom = startOfMonth(today);
  const [dialog, setDialog] = useState<Kind | null>(
    startAction === "drawing" && !owner ? null : (startAction ?? null),
  );
  const [shown, setShown] = useState<Kind>(
    startAction ?? (BOOKS_SIMPLE ? "income" : "transfer"),
  );
  // Bumped after a save, so the list shown reads itself again.
  const [saved, setSaved] = useState(0);
  const overview = useApiQuery(
    booksMoneyContract.getBooksOverview,
    allowed ? { query: { date: today } } : null,
  );
  const transfersThisMonth = useApiQuery(
    booksMoneyContract.listBankTransfers,
    allowed ? { query: { from: monthFrom, to: today, limit: 1 } } : null,
  );

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The books are for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  const bankList = banks.status === "ready" ? activeBanks(banks.data.data) : [];
  const officeCash =
    overview.status === "ready" ? overview.data.officeCash : null;
  const done = (kind: Kind) => {
    setDialog(null);
    setShown(kind);
    setSaved((count) => count + 1);
    overview.reload();
    transfersThisMonth.reload();
  };

  return (
    <>
      <PageHeader
        title={
          BOOKS_SIMPLE ? "Owner money & income" : "Contra, receipts & drawings"
        }
        description={
          BOOKS_SIMPLE
            ? "Money the owner adds or takes out, and income that is not a collection."
            : "Money moving between the office and the banks, money earned beside collections, and money the owner takes out."
        }
      />

      <ul
        aria-label="Actions"
        className={cn(
          "grid grid-cols-1 gap-3",
          BOOKS_SIMPLE ? "md:grid-cols-2" : "md:grid-cols-3",
        )}
      >
        {/* Simple Books (lib/books-mode.ts): no bank, so no contra. */}
        {BOOKS_SIMPLE ? null : (
          <ActionCard
            icon={ArrowsLeftRight}
            title="Contra entry"
            text="Cash deposit, cash withdrawal, or bank to bank."
            action={
              <Button
                tone="primary"
                onClick={() => setDialog("transfer")}
                disabled={bankList.length === 0}
              >
                Contra entry
              </Button>
            }
            note={
              bankList.length === 0
                ? "Add a bank account in Settings first."
                : undefined
            }
          />
        )}
        <ActionCard
          icon={Coins}
          title="Other income"
          text="Money earned that is not a collection — a processing fee."
          action={
            <Button tone="secondary" onClick={() => setDialog("income")}>
              Record income
            </Button>
          }
        />
        <ActionCard
          icon={HandCoins}
          title="Owner took money"
          text="Money the owner takes out for home. Not an expense."
          action={
            owner ? (
              <Button tone="secondary" onClick={() => setDialog("drawing")}>
                Record drawing
              </Button>
            ) : (
              <Badge>Owner only</Badge>
            )
          }
        />
      </ul>

      <StatGrid columns={BOOKS_SIMPLE ? 2 : 3} aria-label="This month">
        {BOOKS_SIMPLE ? null : (
          <Stat
            label="Contra"
            hint={
              transfersThisMonth.status === "ready"
                ? `${transfersThisMonth.data.total} ${transfersThisMonth.data.total === 1 ? "transfer" : "transfers"} this month`
                : "This month"
            }
          >
            {transfersThisMonth.status === "ready"
              ? formatCurrency(transfersThisMonth.data.amountTotal)
              : "—"}
          </Stat>
        )}
        <Stat label="Other income" hint="This month">
          {overview.status === "ready"
            ? formatCurrency(overview.data.month.otherIncome)
            : "—"}
        </Stat>
        <Stat label="Owner took out" hint="This month">
          {overview.status === "ready"
            ? formatCurrency(overview.data.month.drawings)
            : "—"}
        </Stat>
      </StatGrid>

      {/* The money a loan is paid from (decided 2026-10-02): first on the
          page, ahead of what moves it around. */}
      <CapitalSection
        canAdd={canAddCapital(me.role)}
        startAdding={startCapital}
        onChanged={() => overview.reload()}
      />

      <Section title="Entries">
        <div
          role="tablist"
          aria-label="Transaction type"
          className="flex w-fit gap-1 rounded-control bg-surface-sunken p-1"
        >
          {(Object.keys(LISTS) as Kind[])
            .filter((kind) => !BOOKS_SIMPLE || kind !== "transfer")
            .map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={shown === kind}
                onClick={() => setShown(kind)}
                className={cn(
                  "rounded-control px-3 py-1.5 text-label transition-colors",
                  shown === kind
                    ? "bg-surface-raised text-ink shadow-raised"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {LISTS[kind].label}
              </button>
            ))}
        </div>
        <MovementList key={`${shown}-${saved}`} kind={shown} />
      </Section>

      {!BOOKS_SIMPLE && dialog === "transfer" ? (
        <TransferDialog
          banks={bankList}
          officeCash={officeCash}
          onClose={() => setDialog(null)}
          onDone={() => done("transfer")}
        />
      ) : null}
      {dialog === "income" ? (
        <OneSidedDialog
          kind="income"
          banks={bankList}
          officeCash={officeCash}
          onClose={() => setDialog(null)}
          onDone={() => done("income")}
        />
      ) : null}
      {dialog === "drawing" ? (
        <OneSidedDialog
          kind="drawing"
          banks={bankList}
          officeCash={officeCash}
          onClose={() => setDialog(null)}
          onDone={() => done("drawing")}
        />
      ) : null}
    </>
  );
}

function ActionCard({
  icon,
  title,
  text,
  action,
  note,
}: {
  icon: typeof Coins;
  title: string;
  text: string;
  action: ReactNode;
  note?: string | undefined;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-5">
      <IconMark icon={icon} />
      <div className="flex flex-col gap-1">
        <h2 className="text-heading text-ink">{title}</h2>
        <p className="text-body text-ink-muted">{text}</p>
      </div>
      <div className="mt-auto flex flex-col items-start gap-1.5">
        {action}
        {note ? (
          <span className="text-caption text-ink-muted">{note}</span>
        ) : null}
      </div>
    </li>
  );
}

/** One kind of movement, newest first, with what the whole list adds up to. */
function MovementList({ kind }: { kind: Kind }) {
  const spec = LISTS[kind];
  const list = usePagedQuery(spec.route, { query: {} });
  if (list.status === "loading") return <ListSkeleton columns={3} rows={3} />;
  if (list.status === "error") {
    return <LoadFailed message={list.message} onRetry={list.reload} />;
  }
  if (list.status !== "ready") return null;
  if (list.rows.length === 0) {
    return <NothingYet title={spec.empty} description="Nothing to show yet." />;
  }
  return (
    <>
      <p className="text-body text-ink-muted">
        {list.total} {list.total === 1 ? spec.noun[1] : spec.noun[0]}, totalling{" "}
        <span className="font-medium text-ink" data-numeric>
          {formatCurrency(list.data.amountTotal)}
        </span>
      </p>
      <ul
        aria-label={spec.label}
        className="divide-y divide-border overflow-hidden rounded-surface border border-border bg-surface-raised"
      >
        {(list.rows as MoneyMovement[]).map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-body font-medium text-ink">
                {entry.note}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
                <PlacePill>
                  {entry.from?.name ??
                    (kind === "income" ? "Income" : OFFICE_CASH)}
                </PlacePill>
                <ArrowRight aria-hidden size={12} />
                <PlacePill>
                  {entry.to?.name ??
                    (kind === "drawing" ? "Owner" : OFFICE_CASH)}
                </PlacePill>
                <span>
                  · {formatBusinessDate(entry.businessDate)}
                  {entry.recordedBy ? ` · ${entry.recordedBy.name}` : ""}
                </span>
              </span>
            </span>
            <span className="text-body font-medium text-ink" data-numeric>
              {formatCurrency(entry.amount)}
            </span>
          </li>
        ))}
      </ul>
      <Pager list={list} noun={spec.noun[0]} nounSingular={spec.noun[1]} />
    </>
  );
}

function PlacePill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-tile border border-border bg-surface-sunken px-1.5 py-0.5 text-ink">
      {children}
    </span>
  );
}

const NEVER_EDITED =
  "An entry cannot be changed afterwards — a mistake is put right with another entry.";

/** `typed` when it is money yet; null while it is still being typed. */
const asTyped = (value: unknown) =>
  /^\d+(\.\d{1,2})?$/.test(String(value ?? "").trim())
    ? String(value).trim()
    : null;

/** The balance a place holds now: office cash, or a bank by id. */
function balanceOf(
  bankAccountId: string | undefined,
  banks: readonly BankAccountView[],
  officeCash: string | null,
) {
  if (!bankAccountId) return officeCash;
  return banks.find((bank) => bank.id === bankAccountId)?.balance ?? null;
}

function NowAfter({
  now,
  after,
}: {
  now: string | null;
  after: string | null;
}) {
  if (now === null) return null;
  return (
    <span className="text-caption text-ink-muted" data-numeric>
      Now {signedAmount(now)}
      {after !== null ? (
        <>
          {" "}
          →{" "}
          <span className="font-medium text-accent">
            after {signedAmount(after)}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Office cash ↔ a bank, or bank ↔ bank (Stitch B-05): two places side by
 * side with a swap between them, each showing its balance now and after.
 */
function TransferDialog({
  banks,
  officeCash,
  onClose,
  onDone,
}: {
  banks: readonly BankAccountView[];
  officeCash: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(booksMoneyContract.recordBankTransfer.body, {
    defaultValues: {
      fromBankAccountId: undefined,
      toBankAccountId: banks[0]?.id,
      amount: "",
      businessDate: undefined,
      note: "",
    },
  });
  const [from, to, amount] = useWatch({
    control: form.control,
    name: ["fromBankAccountId", "toBankAccountId", "amount"],
  });
  const typed = asTyped(amount);
  const fromNow = balanceOf(from || undefined, banks, officeCash);
  const toNow = balanceOf(to || undefined, banks, officeCash);
  const swap = () => {
    form.setValue("fromBankAccountId", to || undefined);
    form.setValue("toBankAccountId", from || undefined);
  };

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="Contra entry"
      description={`Deposit office cash in a bank, take it out, or move it between banks. ${NEVER_EDITED}`}
      submitLabel={
        typed ? `Post contra ${formatCurrency(typed)}` : "Post contra"
      }
      pendingLabel="Saving…"
      onSubmit={async (body) => {
        const result = await apiWrite(booksMoneyContract.recordBankTransfer, {
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: [
              "fromBankAccountId",
              "toBankAccountId",
              "amount",
              "businessDate",
              "note",
            ],
          });
        }
        toast({
          title: `${formatCurrency(result.body.amount)} moved`,
          description: `${result.body.from?.name ?? OFFICE_CASH} → ${result.body.to?.name ?? OFFICE_CASH}`,
        });
        onDone();
      }}
    >
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-col gap-1.5 rounded-surface border border-border p-3">
          <PlaceField name="fromBankAccountId" label="From" banks={banks} />
          <NowAfter
            now={fromNow}
            after={
              fromNow !== null && typed ? subtractMoney(fromNow, typed) : null
            }
          />
        </div>
        <Button
          tone="secondary"
          size="sm"
          onClick={swap}
          aria-label="Swap from and to"
          className="mb-6 self-center rounded-pill"
        >
          <ArrowsDownUp aria-hidden size={16} className="sm:rotate-90" />
        </Button>
        <div className="flex flex-col gap-1.5 rounded-surface border border-border p-3">
          <PlaceField name="toBankAccountId" label="To" banks={banks} />
          <NowAfter
            now={toNow}
            after={toNow !== null && typed ? addMoney(toNow, typed) : null}
          />
        </div>
      </div>
      <FormField name="amount" label="Amount (₹)">
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="h-12 text-title"
          data-numeric
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="businessDate"
          label="Date"
          hint="Leave blank for today. Never a future date."
          valueAs="optional"
        >
          <Input type="date" max={toBusinessDate(new Date())} />
        </FormField>
        <FormField
          name="note"
          label="Note"
          hint="“Deposit of Monday’s collections”."
          valueAs="trimmed"
        >
          <Textarea maxLength={500} rows={2} />
        </FormField>
      </div>
    </DialogForm>
  );
}

/** Other income into a place, or a drawing out of one (the owner's alone). */
function OneSidedDialog({
  kind,
  banks,
  officeCash,
  onClose,
  onDone,
}: {
  kind: "income" | "drawing";
  banks: readonly BankAccountView[];
  officeCash: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const income = kind === "income";
  const route = income
    ? booksMoneyContract.recordOtherIncome
    : booksMoneyContract.recordDrawing;
  const form = useZodForm(route.body, {
    defaultValues: {
      amount: "",
      businessDate: undefined,
      note: "",
      bankAccountId: undefined,
    },
  });
  const [bankAccountId, amount] = useWatch({
    control: form.control,
    name: ["bankAccountId", "amount"],
  });
  const typed = asTyped(amount);
  const now = balanceOf(bankAccountId || undefined, banks, officeCash);
  const after =
    now !== null && typed
      ? income
        ? addMoney(now, typed)
        : subtractMoney(now, typed)
      : null;

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={income ? "Other income" : "Owner took money"}
      description={
        income
          ? `Money earned that is not a collection. It adds to the profit. ${NEVER_EDITED}`
          : `Withdrawn by the owner. ${NEVER_EDITED}`
      }
      submitLabel={income ? "Record income" : "Record drawing"}
      pendingLabel="Recording…"
      onSubmit={async (body) => {
        const result = await apiWrite(route, { body });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["amount", "businessDate", "note", "bankAccountId"],
          });
        }
        toast({
          title: `${formatCurrency(result.body.amount)} ${income ? "receipt" : "drawing"} recorded`,
          description: income
            ? `Into ${result.body.to?.name ?? OFFICE_CASH}`
            : `From ${result.body.from?.name ?? OFFICE_CASH}`,
        });
        onDone();
      }}
    >
      <FormField name="amount" label="Amount (₹)">
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="h-12 text-title"
          data-numeric
        />
      </FormField>
      <div className="flex flex-col gap-1.5">
        {/* Simple Books: always cash in hand. */}
        {BOOKS_SIMPLE ? null : (
          <PlaceField
            name="bankAccountId"
            label={income ? "Received into" : "Taken from"}
            banks={banks}
          />
        )}
        <NowAfter now={now} after={after} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="businessDate"
          label={income ? "Received on" : "Taken on"}
          hint="Leave blank for today. Never a future date."
          valueAs="optional"
        >
          <Input type="date" max={toBusinessDate(new Date())} />
        </FormField>
        <FormField
          name="note"
          label="Note"
          hint={
            income
              ? "“Processing fee, Kumar”, “Savings interest for March”."
              : "“For home”, “School fees”."
          }
          valueAs="trimmed"
        >
          <Textarea maxLength={500} rows={2} />
        </FormField>
      </div>
      <p className="flex items-start gap-2 text-caption text-ink-muted">
        <Info aria-hidden size={16} className="mt-px shrink-0" />
        {income
          ? "Other income adds to the profit, beside what collections earn."
          : "Not an expense: it lowers the owner's money in the business, not the profit."}
      </p>
    </DialogForm>
  );
}
