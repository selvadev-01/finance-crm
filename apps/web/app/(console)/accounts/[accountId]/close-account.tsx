"use client";

import { type Account, accountContract } from "@repo/contracts";
import {
  DialogForm,
  FormField,
  FormMessage,
  formatCurrency,
  Select,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import { useWatch } from "react-hook-form";

import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";

/**
 * US-035 · stop collecting on an account. Super Admin only, because writing
 * off destroys receivable value (M05).
 *
 * The two closures are different decisions and the dialog says so: defaulting
 * stops collection and leaves the money owed, while writing off gives it up
 * and posts the loss to the ledger.
 */
export function CloseAccount({
  account,
  onClose,
  onDone,
}: {
  account: Account;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(accountContract.closeAccount.body, {
    defaultValues: { status: "DEFAULTED", note: "" },
  });
  const status = useWatch({ control: form.control, name: "status" });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Close ${account.accountCode}`}
      description={`${account.customerName} still owes ${formatCurrency(account.outstandingAmount)}.`}
      submitLabel="Close account"
      pendingLabel="Closing…"
      tone="danger"
      onSubmit={async (body) => {
        const result = await apiWrite(accountContract.closeAccount, {
          params: { accountId: account.id },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["status", "note"],
            fallback: "The account was not closed.",
          });
        }
        toast({
          title: `${account.accountCode} ${
            result.body.status === "WRITTEN_OFF" ? "written off" : "defaulted"
          }`,
        });
        onDone();
      }}
    >
      <FormField name="status" label="Closure">
        <Select>
          <option value="DEFAULTED">Defaulted — still owed</option>
          <option value="WRITTEN_OFF">Written off — given up</option>
        </Select>
      </FormField>
      <FormField
        name="note"
        label="Reason"
        hint="Kept with the account, and shown in its history."
      >
        <Textarea rows={3} maxLength={500} />
      </FormField>
      <FormMessage tone={status === "WRITTEN_OFF" ? "critical" : "warning"}>
        {status === "WRITTEN_OFF"
          ? `Collection stops and ${formatCurrency(account.outstandingAmount)} is given up: the ledger posts the loss, and it cannot be undone.`
          : "Collection stops, and the money stays owed on the books. It can be written off later."}
      </FormMessage>
    </DialogForm>
  );
}
