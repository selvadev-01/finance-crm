"use client";

import {
  ArrowRight,
  ArrowsLeftRight,
  Bank,
  CheckCircle,
  Plus,
  Receipt,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import {
  type BankAccountView,
  type ExpenseCategory,
  type JournalEntry,
  type JournalLineInput,
  journalContract,
  postJournalBodySchema,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogActions,
  EmptyFrame,
  Field,
  formatBusinessDate,
  formatCurrency,
  FormMessage,
  Input,
  ListSkeleton,
  NothingYet,
  NotPermitted,
  PageHeader,
  Select,
  Textarea,
  toast,
} from "@repo/ui";
import { useState } from "react";

import { EntryLines } from "../../../../components/entry-lines";
import { Pager } from "../../../../components/pager";
import { LoadFailed } from "../../../../components/query-state";
import { apiWrite } from "../../../../lib/api-write";
import {
  absMoney,
  isZeroMoney,
  subtractMoney,
  sumMoney,
} from "../../../../lib/money";
import { canManageOrganisation, seesSettings } from "../../../../lib/roles";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import {
  activeBanks,
  activeCategories,
  bankLabel,
  useBanks,
  useCategories,
} from "../books-parts";
import { IconMark, Note } from "../visuals";

/** The organization's accounts a journal may name, by type (ADR-0018). */
const SINGLETONS = [
  ["CASH_AT_OFFICE", "Cash-in-hand"],
  ["CAPITAL", "Capital A/c"],
  ["OWNER_DRAWINGS", "Drawings"],
  ["OTHER_INCOME", "Other receipts"],
  ["WRITE_OFF_LOSS", "Write-off loss"],
] as const;

interface Draft {
  key: number;
  /** `CAPITAL`, `BANK:<id>` or `EXPENSE:<id>`. */
  account: string;
  debit: string;
  credit: string;
}

let nextKey = 1;
const blank = (account = ""): Draft => ({
  key: nextKey++,
  account,
  debit: "",
  credit: "",
});

type Template = "move" | "charges" | "opening" | "blank";

const TEMPLATES: { id: Template; label: string; note: string }[] = [
  {
    id: "move",
    label: "Transfer between expense heads",
    note: "Dr the correct head, Cr the wrong one.",
  },
  {
    id: "charges",
    label: "Bank charges",
    note: "Dr Bank charges, Cr the bank.",
  },
  {
    id: "opening",
    label: "Opening balance",
    note: "Dr the bank, Cr Capital A/c.",
  },
  { id: "blank", label: "Blank", note: "Any balanced lines." },
];

/** A template's starting lines, with the accounts it can already name. */
function linesFor(
  template: Template,
  banks: readonly BankAccountView[],
  categories: readonly ExpenseCategory[],
): Draft[] {
  const bank = banks[0] ? `BANK:${banks[0].id}` : "";
  const charges = categories.find((each) => /bank/i.test(each.name));
  switch (template) {
    case "move":
      return [blank(), blank()];
    case "charges":
      return [blank(charges ? `EXPENSE:${charges.id}` : ""), blank(bank)];
    case "opening":
      return [blank(bank), blank("CAPITAL")];
    default:
      return [blank(), blank()];
  }
}

/** A typed amount as money, or zero while it is not one yet. */
const asMoney = (value: string) =>
  /^\d+(\.\d{1,2})?$/.test(value.trim()) ? value.trim() : "0";

/** A draft line as the contract's line, or the reason it is not one yet. */
function toLine(draft: Draft): JournalLineInput | string {
  const [type, id] = draft.account.split(":");
  if (!type) return "Choose an account on every line, or remove it.";
  const debit = draft.debit.trim();
  const credit = draft.credit.trim();
  if (debit && credit) return "A line is either a debit or a credit, not both.";
  if (!debit && !credit) return "Every line needs a debit or a credit amount.";
  return {
    accountType: type as JournalLineInput["accountType"],
    ...(type === "BANK" ? { bankAccountId: id } : {}),
    ...(type === "EXPENSE" ? { categoryId: id } : {}),
    direction: debit ? "DEBIT" : "CREDIT",
    amount: debit || credit,
  };
}

/**
 * Books · journal (ADR-0018, US-106; Stitch B-10, B-11): the owner's
 * correcting entries, for what no business event records. Admins read them;
 * only the Super Admin posts one, and never to cash in hand, the loan book or
 * profit, which the nightly reconciliation holds to the collections.
 */
export function Journal() {
  const me = useSignedIn();
  const allowed = canManageOrganisation(me.role);
  const owner = seesSettings(me.role);
  const [posting, setPosting] = useState<Template | null>(null);
  const entries = usePagedQuery(
    journalContract.listJournalEntries,
    allowed ? { query: {} } : null,
    { url: true },
  );
  const banks = useBanks(allowed && owner);
  const categories = useCategories(allowed && owner);

  if (!allowed) {
    return (
      <EmptyFrame>
        <NotPermitted description="The ledger is for Super Admins and Admins." />
      </EmptyFrame>
    );
  }

  const post = owner ? (
    <Button tone="primary" onClick={() => setPosting("blank")}>
      <Plus aria-hidden size={16} />
      New journal voucher
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Journal voucher"
        description="Correcting entries, for what no other screen records. Each one balances, says why, and is never edited."
        actions={post}
      />

      <Note>
        Use a journal only to correct the books — a category booked wrongly,
        charges found on the passbook, an opening balance. Collections,
        handovers and loans can never be changed here.
      </Note>

      {owner ? (
        <ul
          aria-label="Templates"
          className="grid grid-cols-1 gap-3 md:grid-cols-3"
        >
          {(
            [
              [
                "move",
                ArrowsLeftRight,
                "Move an expense to the right category",
              ],
              ["charges", Bank, "Bank charges from the passbook"],
              ["opening", Receipt, "Opening balance of a bank"],
            ] as const
          ).map(([template, icon, title]) => (
            <li key={template}>
              <button
                type="button"
                onClick={() => setPosting(template)}
                className="flex h-full w-full items-start gap-3 rounded-surface border border-border bg-surface-raised p-4 text-left transition-colors hover:border-accent hover:bg-accent-subtle"
              >
                <IconMark icon={icon} />
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-body font-medium text-ink">
                    {title}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {TEMPLATES.find((each) => each.id === template)?.note}
                  </span>
                </span>
                <ArrowRight aria-hidden size={16} className="text-ink-subtle" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {entries.status === "loading" ? (
        <ListSkeleton columns={3} rows={3} />
      ) : null}
      {entries.status === "error" ? (
        <LoadFailed message={entries.message} onRetry={entries.reload} />
      ) : null}
      {entries.status === "ready" ? (
        entries.rows.length === 0 ? (
          <EmptyFrame>
            <NothingYet
              title="No journal entries"
              description={
                owner
                  ? "Expenses, transfers and collections post themselves. Use a journal only to correct what they could not."
                  : "The owner posts correcting entries here."
              }
              action={post ?? undefined}
            />
          </EmptyFrame>
        ) : (
          <>
            <ul className="flex flex-col gap-3" aria-label="Journal vouchers">
              {entries.rows.map((entry) => (
                <li key={entry.id}>
                  <EntryCard entry={entry} />
                </li>
              ))}
            </ul>
            <Pager list={entries} noun="entries" nounSingular="entry" />
          </>
        )
      ) : null}

      {posting ? (
        <PostJournalDialog
          template={posting}
          banks={banks.status === "ready" ? activeBanks(banks.data.data) : []}
          categories={
            categories.status === "ready"
              ? activeCategories(categories.data.data)
              : []
          }
          onClose={() => setPosting(null)}
          onPosted={() => {
            setPosting(null);
            entries.reload();
          }}
        />
      ) : null}
    </>
  );
}

function EntryCard({ entry }: { entry: JournalEntry }) {
  return (
    <article className="flex flex-col gap-3 rounded-surface border border-border bg-surface-raised p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-body font-semibold text-ink">{entry.note}</span>
          <span className="text-caption text-ink-muted">
            {formatBusinessDate(entry.businessDate)}
            {entry.recordedBy ? ` · by ${entry.recordedBy.name}` : ""}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <Badge tone="positive">Balanced</Badge>
          <span className="text-body font-semibold text-ink" data-numeric>
            {formatCurrency(entry.amount)}
          </span>
        </span>
      </header>
      <EntryLines
        caption="Lines of the entry"
        lines={entry.lines.map((line) => ({
          particulars: line.name,
          direction: line.direction,
          amount: line.amount,
        }))}
      />
    </article>
  );
}

/**
 * The owner's journal, line by line in Debit and Credit columns (Stitch
 * B-11). Validated by the contract's own schema before it is sent — balanced,
 * two lines or more, a reason — and the totals show as it is typed, so an
 * unbalanced entry is visible before it is refused.
 */
function PostJournalDialog({
  template: initialTemplate,
  banks,
  categories,
  onClose,
  onPosted,
}: {
  template: Template;
  banks: readonly BankAccountView[];
  categories: readonly ExpenseCategory[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const today = toBusinessDate(new Date());
  const [template, setTemplate] = useState(initialTemplate);
  const [businessDate, setBusinessDate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Draft[]>(() =>
    linesFor(initialTemplate, banks, categories),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const debits = sumMoney(lines.map((line) => asMoney(line.debit)));
  const credits = sumMoney(lines.map((line) => asMoney(line.credit)));
  const difference = subtractMoney(debits, credits);
  const balanced = isZeroMoney(difference) && !isZeroMoney(debits);

  const change = (key: number, patch: Partial<Draft>) =>
    setLines((all) =>
      all.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  const start = (next: Template) => {
    setTemplate(next);
    setLines(linesFor(next, banks, categories));
    setProblem(null);
  };

  async function submit() {
    const drafted = lines.map(toLine);
    const unready = drafted.find((line) => typeof line === "string");
    if (typeof unready === "string") return setProblem(unready);
    const parsed = postJournalBodySchema.safeParse({
      ...(businessDate ? { businessDate } : {}),
      note,
      lines: drafted,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return setProblem(
        issue?.path[0] === "note"
          ? "Say why this entry is needed."
          : issue?.path.includes("amount")
            ? "Every amount must be above zero, like 500 or 49.50."
            : (issue?.message ?? "Check the lines."),
      );
    }
    setPending(true);
    setProblem(null);
    const result = await apiWrite(journalContract.postJournalEntry, {
      body: parsed.data,
    });
    setPending(false);
    if (!result.ok) return setProblem(result.form ?? "Not posted. Try again.");
    toast({
      title: `Journal of ${formatCurrency(result.body.amount)} posted`,
      description: result.body.note,
    });
    onPosted();
  }

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      size="lg"
      title="New journal voucher"
      description="Debits must equal credits. It posts at once and cannot be changed — a mistake is answered by another entry."
    >
      <div className="flex flex-col gap-4">
        <div
          role="group"
          aria-label="Template"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-label text-ink-muted">Start from</span>
          {TEMPLATES.map((each) => (
            <button
              key={each.id}
              type="button"
              aria-pressed={template === each.id}
              onClick={() => start(each.id)}
              className={cn(
                "rounded-control border px-2.5 py-1 text-label transition-colors",
                template === each.id
                  ? "border-accent bg-accent-subtle text-accent"
                  : "border-border text-ink hover:border-border-strong",
              )}
            >
              {each.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-surface border border-border">
          <table className="w-full min-w-[34rem]">
            <caption className="sr-only">Lines</caption>
            <thead>
              <tr className="bg-surface-sunken text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
                <th scope="col" className="px-3 py-2 text-left">
                  Particulars
                </th>
                <th scope="col" className="w-36 px-3 py-2 text-right">
                  Debit (₹)
                </th>
                <th scope="col" className="w-36 px-3 py-2 text-right">
                  Credit (₹)
                </th>
                <th scope="col" className="w-12">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.key} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Select
                      aria-label={`Line ${index + 1} account`}
                      value={line.account}
                      onChange={(event) =>
                        change(line.key, { account: event.target.value })
                      }
                    >
                      <option value="" disabled>
                        Choose an account
                      </option>
                      <optgroup label="Office">
                        {SINGLETONS.map(([type, label]) => (
                          <option key={type} value={type}>
                            {label}
                          </option>
                        ))}
                      </optgroup>
                      {banks.length > 0 ? (
                        <optgroup label="Banks">
                          {banks.map((bank) => (
                            <option key={bank.id} value={`BANK:${bank.id}`}>
                              {bankLabel(bank)}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {categories.length > 0 ? (
                        <optgroup label="Expenses">
                          {categories.map((category) => (
                            <option
                              key={category.id}
                              value={`EXPENSE:${category.id}`}
                            >
                              {category.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Line ${index + 1} debit`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={line.debit}
                      placeholder={line.credit ? "—" : ""}
                      onChange={(event) =>
                        change(line.key, { debit: event.target.value })
                      }
                      className="text-right"
                      data-numeric
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Line ${index + 1} credit`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={line.credit}
                      placeholder={line.debit ? "—" : ""}
                      onChange={(event) =>
                        change(line.key, { credit: event.target.value })
                      }
                      className="text-right"
                      data-numeric
                    />
                  </td>
                  <td className="px-1 py-2 text-center">
                    <Button
                      tone="ghost"
                      size="sm"
                      aria-label={`Remove line ${index + 1}`}
                      disabled={lines.length <= 2}
                      onClick={() =>
                        setLines((all) =>
                          all.filter((each) => each.key !== line.key),
                        )
                      }
                    >
                      <Trash aria-hidden size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td colSpan={4} className="px-3 py-2">
                  <Button
                    tone="ghost"
                    size="sm"
                    disabled={lines.length >= 20}
                    onClick={() => setLines((all) => [...all, blank()])}
                  >
                    <Plus aria-hidden size={16} />
                    Add line
                  </Button>
                </td>
              </tr>
              <tr className="border-t border-border bg-surface-sunken">
                <th scope="row" className="px-3 py-2.5 text-left">
                  <span className="flex flex-wrap items-center gap-2 text-2xs font-medium tracking-[0.08em] text-ink-muted uppercase">
                    Total
                    {balanced ? (
                      <Badge tone="positive">
                        <CheckCircle aria-hidden size={12} /> Balanced
                      </Badge>
                    ) : (
                      <Badge tone="warning">
                        {isZeroMoney(debits) && isZeroMoney(credits)
                          ? "Nothing entered"
                          : `Out by ${formatCurrency(absMoney(difference))}`}
                      </Badge>
                    )}
                  </span>
                </th>
                <td
                  className="px-3 py-2.5 text-right text-body font-semibold text-ink"
                  data-numeric
                >
                  {formatCurrency(debits)}
                </td>
                <td
                  className="px-3 py-2.5 text-right text-body font-semibold text-ink"
                  data-numeric
                >
                  {formatCurrency(credits)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field label="Date" hint="Blank is today. Never a future date.">
            <Input
              type="date"
              max={today}
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
            />
          </Field>
          <Field label="Narration" hint="An accountant reads this later.">
            <Textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>
        <Note size="caption">
          Not allowed here: staff cash in hand, loans to customers, or profit —
          those change only through collections, handovers and corrections.
        </Note>
        {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      </div>
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          aria-busy={pending || undefined}
          tone="primary"
          onClick={() => void submit()}
          disabled={pending}
        >
          {pending ? "Posting…" : "Post entry"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
