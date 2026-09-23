"use client";

import { type Account, accountContract } from "@repo/contracts";
import { COLLECTION_FREQUENCIES } from "@repo/domain";
import {
  DialogForm,
  FormField,
  FormMessage,
  formatCurrency,
  Input,
  Select,
  toast,
  useZodForm,
} from "@repo/ui";
import { useWatch } from "react-hook-form";

import { apiWrite } from "../../../../lib/api-write";
import { CADENCE, cadenceOf } from "../../../../lib/cadence";
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
      // Carried from the account, not defaulted: the field is part of the
      // whole set of terms this dialog resubmits, and leaving it out would
      // quietly put a pending weekly account back on a daily round.
      collectionFrequency: account.collectionFrequency,
      disbursementDate: account.disbursementDate,
    },
  });
  const watched = useWatch({ control: form.control });
  const cadence = CADENCE[cadenceOf(watched.collectionFrequency)];

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
              "collectionFrequency",
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
        <FormField name="dailyAmount" label={cadence.amount}>
          <Input inputMode="decimal" autoComplete="off" />
        </FormField>
        <FormField name="termDays" label={cadence.term}>
          <Input inputMode="numeric" autoComplete="off" />
        </FormField>
      </div>
      <FormField
        name="collectionFrequency"
        label="Collection frequency"
        hint="Fixed once the account is disbursed."
      >
        <Select>
          {COLLECTION_FREQUENCIES.map((frequency) => (
            <option key={frequency} value={frequency}>
              {CADENCE[frequency].option}
            </option>
          ))}
        </Select>
      </FormField>
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
