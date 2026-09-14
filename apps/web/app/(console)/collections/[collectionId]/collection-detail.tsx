"use client";

import { collectionContract, type CollectionDetail } from "@repo/contracts";
import {
  Badge,
  Button,
  DataTable,
  DataTableSkeleton,
  Dialog,
  DialogActions,
  Field,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Input,
  PageHeader,
  Textarea,
} from "@repo/ui";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { apiWrite } from "../../../../lib/api-write";
import { useApiQuery } from "../../../../lib/use-api-query";
import { LoadFailed, RecordNotFound } from "../../_organisation/list-controls";
import { ClassificationBadge, EntryBadge, signedAmount } from "../collection-parts";

const DECISION = {
  PENDING: { label: "Awaiting approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "neutral" },
} as const;

/**
 * S-17 · Collection detail — the collection as recorded, every correction of
 * it with who asked, why, and who decided, and the net that stands (BR-14).
 * A Senior requests a correction here; an Admin reverses.
 */
export function CollectionDetailView({ collectionId }: { collectionId: string }) {
  const [dialog, setDialog] = useState<"correct" | "reverse" | null>(null);
  const collection = useApiQuery(collectionContract.getCollection, { params: { collectionId } });

  if (collection.status === "loading") return <DataTableSkeleton columns={4} rows={4} />;
  if (collection.status === "not-found" || collection.status === "not-permitted") {
    return <RecordNotFound noun="Collection" />;
  }
  if (collection.status === "error") {
    return <LoadFailed message={collection.message} onRetry={collection.reload} />;
  }

  const record = collection.data;
  const isAdjustment = record.entryType === "ADJUSTMENT";
  const pending = record.adjustments.find((adjustment) => adjustment.status === "PENDING_APPROVAL");

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/collections" className="hover:text-ink hover:underline">Collections</Link>}
        title={
          <span>
            {record.customerName} · <span className="font-mono">{record.accountCode}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EntryBadge entry={record} />
            <span>
              {formatBusinessDate(record.businessDate)} · {record.lineName} · collected by {record.collectedByName}
            </span>
          </span>
        }
        actions={
          <span className="flex flex-wrap gap-2">
            {record.canRequestCorrection ? (
              <Button tone="secondary" onClick={() => setDialog("correct")}>
                Request correction
              </Button>
            ) : null}
            {record.canReverse ? (
              <Button tone="danger" onClick={() => setDialog("reverse")}>
                Reverse
              </Button>
            ) : null}
          </span>
        }
      />

      {isAdjustment && record.adjustsCollectionId ? (
        <FormMessage tone="info">
          This is a correction.{" "}
          <Link href={`/collections/${record.adjustsCollectionId}`} className="font-medium underline">
            Open the collection it corrects
          </Link>
          .
        </FormMessage>
      ) : null}
      {pending ? (
        <FormMessage tone="info">
          A correction to {signedAmount(pending)} is awaiting approval; nothing has moved yet.{" "}
          {pending.approval?.canDecide ? (
            <Link href="/collections/pending-approval" className="font-medium underline">
              Decide it in Pending approvals
            </Link>
          ) : null}
        </FormMessage>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Recorded">{signedAmount(record)}</Figure>
        {!isAdjustment ? <Figure label="Stands at">{formatCurrency(record.netAmount)}</Figure> : null}
        {!isAdjustment ? <Figure label="Expected that day">{formatCurrency(record.expectedAmount)}</Figure> : null}
        <Figure label="Account outstanding">{formatCurrency(record.account.outstandingAmount)}</Figure>
      </dl>
      {record.note ? <p className="text-sm text-ink-muted">Note: {record.note}</p> : null}

      {!isAdjustment ? (
        <section aria-labelledby="corrections" className="flex flex-col gap-3">
          <h2 id="corrections" className="text-base font-semibold text-ink">
            Corrections
          </h2>
          {record.adjustments.length === 0 ? (
            <p className="text-sm text-ink-muted">None. The collection stands as recorded.</p>
          ) : (
            <DataTable
              caption="Corrections"
              rows={record.adjustments}
              rowKey={(adjustment) => adjustment.id}
              columns={[
                { header: "Requested", cell: (adjustment) => formatBusinessDate(adjustment.businessDate) },
                {
                  header: "Change",
                  align: "end",
                  cell: (adjustment) => <span data-numeric>{signedAmount(adjustment)}</span>,
                },
                {
                  header: "Why",
                  cell: (adjustment) =>
                    adjustment.approval ? (
                      <span className="flex flex-col">
                        {adjustment.approval.reason}
                        <span className="text-2xs text-ink-muted">asked by {adjustment.approval.requestedByName}</span>
                      </span>
                    ) : null,
                },
                {
                  header: "Decision",
                  align: "end",
                  cell: (adjustment) =>
                    adjustment.approval ? (
                      <span className="flex flex-col items-end gap-1">
                        <Badge tone={DECISION[adjustment.approval.decision].tone}>
                          {DECISION[adjustment.approval.decision].label}
                        </Badge>
                        {adjustment.approval.decidedByName ? (
                          <span className="text-2xs text-ink-muted">
                            by {adjustment.approval.decidedByName}
                            {adjustment.approval.decisionNote ? ` — ${adjustment.approval.decisionNote}` : ""}
                          </span>
                        ) : null}
                      </span>
                    ) : null,
                },
              ]}
            />
          )}
        </section>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          With this correction the collection reads as <ClassificationBadge classification={record.classification} />
        </p>
      )}

      {dialog ? (
        <RequestDialog
          record={record}
          kind={dialog}
          onClose={() => setDialog(null)}
          onRequested={() => {
            setDialog(null);
            collection.reload();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Request a correction (a Senior: what was actually collected) or a reversal
 * (an Admin: to ₹0). Either way it waits for someone else's approval.
 */
function RequestDialog({
  record,
  kind,
  onClose,
  onRequested,
}: {
  record: CollectionDetail;
  kind: "correct" | "reverse";
  onClose: () => void;
  onRequested: () => void;
}) {
  const [amount, setAmount] = useState(record.netAmount);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setProblem(null);
    const result =
      kind === "correct"
        ? await apiWrite(collectionContract.requestCorrection, {
            params: { collectionId: record.id },
            body: { correctedAmount: amount, reason },
          })
        : await apiWrite(collectionContract.requestReversal, {
            params: { collectionId: record.id },
            body: { reason },
          });
    setPending(false);
    if (!result.ok) {
      setFields(result.fields);
      return setProblem(result.form);
    }
    onRequested();
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={
        kind === "correct"
          ? `Request a correction of ${record.accountCode}`
          : `Reverse ${formatCurrency(record.netAmount)} collected from ${record.customerName}`
      }
      description={
        kind === "correct"
          ? `It stands at ${formatCurrency(record.netAmount)}. Enter what was actually collected. Nothing changes until another approver agrees.`
          : "The collection goes to ₹0 and the outstanding rises by the same, once another approver agrees. Both records stay in history."
      }
    >
      {kind === "correct" ? (
        <Field label="Actually collected (₹)" error={fields["correctedAmount"]}>
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} data-numeric />
        </Field>
      ) : null}
      <Field label="Reason" hint="Required. The approver sees it." error={fields["reason"]}>
        <Textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button tone={kind === "correct" ? "primary" : "danger"} onClick={() => void submit()} disabled={pending}>
          {pending ? "Sending…" : kind === "correct" ? "Request correction" : "Request reversal"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3">
      <dt className="text-2xs font-medium tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="text-base font-semibold text-ink" data-numeric>
        {children}
      </dd>
    </div>
  );
}

