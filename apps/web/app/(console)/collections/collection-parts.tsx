"use client";

import {
  type ApprovalQueueItem,
  collectionContract,
  type CollectionListItem,
} from "@repo/contracts";
import {
  DialogForm,
  FormField,
  formatCurrency,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";

import { signedCurrency } from "../../../components/money";
import { apiWrite } from "../../../lib/api-write";
import { applyWriteFailure } from "../../../lib/form-errors";
import { absMoney, isNegativeMoney } from "../../../lib/money";
import type { Role } from "../../../lib/roles";

/**
 * `collection.approveCorrection`: Senior (own line), Admin, Super Admin.
 * Convenience only — the API refuses again (rbac-matrix.md#enforcement).
 */
export function canApproveCorrections(role: Role): boolean {
  return role !== "JUNIOR";
}

/**
 * A collection's amount as the console shows it: an original as recorded,
 * unsigned; an adjustment as a signed change, `−₹20.00` or `+₹20.00`.
 */
export function signedAmount(
  entry: Pick<CollectionListItem, "entryType" | "amount">,
): string {
  return entry.entryType === "ORIGINAL"
    ? formatCurrency(entry.amount)
    : signedCurrency(entry.amount);
}

/**
 * Approve or reject one correction. The title names the consequence
 * (design-system.md rule 7): whose collection, from what to what, and which way
 * the outstanding moves.
 */
export function DecisionDialog({
  item,
  decision,
  onClose,
  onDecided,
}: {
  item: ApprovalQueueItem;
  decision: "APPROVED" | "REJECTED";
  onClose: () => void;
  onDecided: () => void;
}) {
  // The decision is the prop, carried as a value; only the note is a field.
  const form = useZodForm(collectionContract.decideApproval.body, {
    defaultValues: { decision, note: "" },
  });
  const { adjustment, original } = item;
  const change = absMoney(adjustment.amount);
  const rises = isNegativeMoney(adjustment.amount);
  const approving = decision === "APPROVED";

  const from = formatCurrency(original.netAmount);
  const to = formatCurrency(item.correctedAmount);
  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={
        approving
          ? `Approve ${adjustment.accountCode}: ${from} becomes ${to}`
          : `Reject the correction of ${adjustment.accountCode}`
      }
      description={
        approving
          ? `${adjustment.customerName}'s outstanding ${rises ? "rises" : "falls"} by ${formatCurrency(change)}, and ${adjustment.collectedByName}'s cash in hand ${rises ? "falls" : "rises"} by the same. The original collection stays in history.`
          : `The collection stays at ${from}. Nothing moves, and the request stays in history as rejected.`
      }
      submitLabel={approving ? "Approve" : "Reject"}
      pendingLabel="Saving…"
      tone={approving ? "primary" : "danger"}
      onSubmit={async (body) => {
        const result = await apiWrite(collectionContract.decideApproval, {
          params: { approvalId: item.id },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["note"],
            fallback: "The decision was not saved.",
          });
        }
        toast({
          title: approving
            ? `Correction of ${adjustment.accountCode} approved`
            : `Correction of ${adjustment.accountCode} rejected`,
        });
        onDecided();
      }}
    >
      <FormField
        name="note"
        label="Note (optional)"
        hint="Recorded with the decision."
      >
        <Textarea rows={2} maxLength={500} />
      </FormField>
    </DialogForm>
  );
}
