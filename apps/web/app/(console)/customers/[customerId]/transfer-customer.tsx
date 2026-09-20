"use client";

import {
  customerContract,
  type CustomerDetail,
  organisationContract as org,
} from "@repo/contracts";
import {
  DialogForm,
  FormControlField,
  FormMessage,
  Combobox,
  FormField,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";

import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { useApiQuery } from "../../../../lib/use-api-query";

/**
 * US-023 · move a customer to another line. The dialog says plainly what does
 * and does not move: from today the new line collects, and every collection
 * already taken stays with the line that took it (BR-15), so neither line's
 * past figures change.
 */
export function TransferCustomer({
  customer,
  onClose,
  onDone,
}: {
  customer: CustomerDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const lines = useApiQuery(org.listLines, { query: { limit: LIST_LIMIT } });
  const form = useZodForm(customerContract.transferCustomer.body, {
    defaultValues: { lineId: "", reason: "" },
  });

  const options = (lines.status === "ready" ? lines.data.data : [])
    .filter((line) => line.id !== customer.lineId)
    .map((line) => ({ value: line.id, label: line.name, hint: line.code }));

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Transfer ${customer.name}`}
      description={`They are on ${customer.lineName} today.`}
      submitLabel="Transfer"
      pendingLabel="Transferring…"
      onSubmit={async (body) => {
        const result = await apiWrite(customerContract.transferCustomer, {
          params: { customerId: customer.id },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["lineId", "reason"],
            fallback: "The customer was not transferred.",
          });
        }
        toast({
          title: `${result.body.name} moved to ${result.body.lineName}`,
        });
        onDone();
      }}
    >
      <FormControlField
        name="lineId"
        label="New line"
        hint={
          lines.status === "ready" && options.length === 0
            ? "There is no other active line."
            : undefined
        }
      >
        {({ field, control }) => (
          <Combobox
            {...control}
            options={options}
            value={field.value}
            onValueChange={(value) => {
              field.onChange(value);
              field.onBlur();
            }}
            placeholder={
              lines.status === "loading" ? "Loading lines…" : "Choose a line"
            }
            searchPlaceholder="Search lines"
            emptyText="No other active line matches."
          />
        )}
      </FormControlField>
      <FormField
        name="reason"
        label="Reason (optional)"
        hint="Kept with the transfer — “moved house”, “shop relocated”."
        valueAs="optional"
      >
        <Textarea rows={2} maxLength={200} />
      </FormField>
      <FormMessage tone="info">
        From today the new line collects. Every collection already taken stays
        with the line that took it, so no past day or report changes.
      </FormMessage>
    </DialogForm>
  );
}
