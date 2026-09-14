"use client";

import {
  type ApprovalQueueItem,
  collectionContract,
  type CollectionListItem,
} from "@repo/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  Field,
  FormMessage,
  formatCurrency,
  Textarea,
} from "@repo/ui";
import { useState } from "react";

import { apiWrite } from "../../../lib/api-write";
import type { Role } from "../../../lib/roles";

/**
 * `collection.approveCorrection`: Senior (own line), Admin, Super Admin.
 * Convenience only — the API refuses again (rbac-matrix.md#enforcement).
 */
export function canApproveCorrections(role: Role): boolean {
  return role !== "JUNIOR";
}

const CLASSIFICATION = {
  CORRECT: { label: "Correct", tone: "positive" },
  LOW: { label: "Low", tone: "warning" },
  EXTRA: { label: "Extra", tone: "info" },
  NO_PAYMENT: { label: "No payment", tone: "critical" },
} as const;

export function ClassificationBadge({
  classification,
}: {
  classification: CollectionListItem["classification"];
}) {
  const { label, tone } = CLASSIFICATION[classification];
  return <Badge tone={tone}>{label}</Badge>;
}

/** An original is simply recorded; only an adjustment has a decision to show. */
export function EntryBadge({ entry }: { entry: CollectionListItem }) {
  if (entry.entryType === "ORIGINAL") return <ClassificationBadge classification={entry.classification} />;
  switch (entry.status) {
    case "PENDING_APPROVAL":
      return <Badge tone="warning">Correction · awaiting approval</Badge>;
    case "CONFIRMED":
      return <Badge tone="neutral">Correction · approved</Badge>;
    case "REJECTED":
      return <Badge tone="neutral">Correction · rejected</Badge>;
    case "REVERSED":
      return <Badge tone="neutral">Reversed</Badge>;
  }
}

/** A signed amount: an adjustment reads `−₹20.00` or `+₹20.00`. */
export function signedAmount(entry: Pick<CollectionListItem, "entryType" | "amount">): string {
  if (entry.entryType === "ORIGINAL") return formatCurrency(entry.amount);
  return entry.amount.startsWith("-")
    ? `−${formatCurrency(entry.amount.slice(1))}`
    : `+${formatCurrency(entry.amount)}`;
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
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { adjustment, original } = item;
  const change = adjustment.amount.startsWith("-") ? adjustment.amount.slice(1) : adjustment.amount;
  const rises = adjustment.amount.startsWith("-");

  async function decide() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(collectionContract.decideApproval, {
      params: { approvalId: item.id },
      body: { decision, ...(note.trim() ? { note } : {}) },
    });
    setPending(false);
    if (!result.ok) return setProblem(result.form ?? "The decision was not saved.");
    onDecided();
  }

  const from = formatCurrency(original.netAmount);
  const to = formatCurrency(item.correctedAmount);
  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={
        decision === "APPROVED"
          ? `Approve ${adjustment.accountCode}: ${from} becomes ${to}`
          : `Reject the correction of ${adjustment.accountCode}`
      }
      description={
        decision === "APPROVED"
          ? `${adjustment.customerName}'s outstanding ${rises ? "rises" : "falls"} by ${formatCurrency(change)}, and ${adjustment.collectedByName}'s cash in hand ${rises ? "falls" : "rises"} by the same. The original collection stays in history.`
          : `The collection stays at ${from}. Nothing moves, and the request stays in history as rejected.`
      }
    >
      <Field label="Note (optional)" hint="Recorded with the decision.">
        <Textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button tone={decision === "APPROVED" ? "primary" : "danger"} onClick={() => void decide()} disabled={pending}>
          {pending ? "Saving…" : decision === "APPROVED" ? "Approve" : "Reject"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
