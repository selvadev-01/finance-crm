"use client";

import { type Account, accountContract } from "@repo/contracts";
import {
  DialogForm,
  FormField,
  FormMessage,
  formatCurrency,
  Input,
  toast,
  useZodForm,
} from "@repo/ui";
import { useWatch } from "react-hook-form";

import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";
import {
  isNegativeMoney,
  isZeroMoney,
  subtractMoney,
} from "../../../../lib/money";

const schema = accountContract.updateAccountTerms.body;

/**
 * US-030 · correct a PENDING account's terms. The only window in which a typo
 * can be fixed: after disbursement the amounts are fixed, in the service and
 * in the database.
 *
 * Saving rebuilds the schedule from the new terms, so the dialog says that
 * plainly rather than leaving the Admin to discover it.
 */
export function CorrectTerms({
  account,
  onClose,
  onDone,
}: {
  account: Account;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(schema, {
    defaultValues: {
      accountAmount: account.accountAmount,
      investedAmount: account.investedAmount ?? "",
      dailyAmount: account.dailyAmount,
      termDays: String(account.termDays),
      disbursementDate: account.disbursementDate,
    },
  });
  const watched = useWatch({ control: form.control });

  // P = A − I, derived and never entered (BR-01). Exact paise, never a number.
  const profit =
    typeof watched.accountAmount === "string" &&
    typeof watched.investedAmount === "string" &&
    /^\d+(\.\d{1,2})?$/.test(watched.accountAmount) &&
    /^\d+(\.\d{1,2})?$/.test(watched.investedAmount)
      ? subtractMoney(watched.accountAmount, watched.investedAmount)
      : null;

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Correct ${account.accountCode}`}
      description={`${account.customerName}, not yet disbursed.`}
      submitLabel="Save terms"
      pendingLabel="Saving…"
      onSubmit={async (body) => {
        const result = await apiWrite(accountContract.updateAccountTerms, {
          params: { accountId: account.id },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: [
              "accountAmount",
              "investedAmount",
              "dailyAmount",
              "termDays",
              "disbursementDate",
            ],
            fallback: "The terms were not saved.",
          });
        }
        toast({ title: `${result.body.accountCode} corrected` });
        onDone();
      }}
    >
      <div className="grid gap-[var(--stack-gap)] sm:grid-cols-2">
        <FormField name="accountAmount" label="Account amount">
          <Input inputMode="decimal" autoComplete="off" autoFocus />
        </FormField>
        <FormField name="investedAmount" label="Invested amount">
          <Input inputMode="decimal" autoComplete="off" />
        </FormField>
        <FormField name="dailyAmount" label="Daily amount">
          <Input inputMode="decimal" autoComplete="off" />
        </FormField>
        <FormField name="termDays" label="Term (days)">
          <Input inputMode="numeric" autoComplete="off" />
        </FormField>
      </div>
      <FormField
        name="disbursementDate"
        label="Disbursement date"
        hint="Today or later. A past date is a mid-term account, entered separately."
      >
        <Input type="date" />
      </FormField>
      <FormMessage tone={profile(profit)}>
        {profit === null
          ? "Profit is the account amount less the invested amount."
          : isNegativeMoney(profit) || isZeroMoney(profit)
            ? "Invested must be below the account amount — profit cannot be zero or negative."
            : `Profit ${formatCurrency(profit)}. Saving rebuilds the whole schedule from these terms.`}
      </FormMessage>
    </DialogForm>
  );
}

/** Neutral until both amounts are readable, then critical if the margin is gone. */
function profile(profit: string | null): "info" | "critical" {
  if (profit === null) return "info";
  return isNegativeMoney(profit) || isZeroMoney(profit) ? "critical" : "info";
}
