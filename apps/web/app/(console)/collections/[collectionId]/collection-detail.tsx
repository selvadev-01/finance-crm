"use client";

import { collectionContract, type CollectionDetail } from "@repo/contracts";
import {
  Button,
  DataView,
  DialogForm,
  FormField,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Input,
  PageHeader,
  Section,
  Stat,
  StatGrid,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import {
  displayColumn,
  moneyColumn,
  valueColumn,
} from "../../../../components/columns";
import { PageTrail } from "../../../../components/page-trail";
import { RecordFallback } from "../../../../components/query-state";
import {
  CollectionEntryBadge,
  StatusBadge,
} from "../../../../components/status-badge";
import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";
import { useApiQuery } from "../../../../lib/use-api-query";
import { signedAmount } from "../collection-parts";

type Adjustment = CollectionDetail["adjustments"][number];

/**
 * S-17 · Collection detail — the collection as recorded, every correction of
 * it with who asked, why, and who decided, and the net that stands (BR-14).
 * A Senior requests a correction here; an Admin reverses.
 */
export function CollectionDetailView({
  collectionId,
}: {
  collectionId: string;
}) {
  const [dialog, setDialog] = useState<"correct" | "reverse" | null>(null);
  const collection = useApiQuery(collectionContract.getCollection, {
    params: { collectionId },
  });

  if (collection.status !== "ready")
    return <RecordFallback query={collection} noun="Collection" />;

  const record = collection.data;
  const isAdjustment = record.entryType === "ADJUSTMENT";
  const pending = record.adjustments.find(
    (adjustment) => adjustment.status === "PENDING_APPROVAL",
  );

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Collections", href: "/collections" },
              { label: record.customerName },
            ]}
          />
        }
        title={record.customerName}
        meta={
          <>
            <span className="font-mono">{record.accountCode}</span>
            <CollectionEntryBadge entry={record} />
            <span>
              {formatBusinessDate(record.businessDate)} · {record.lineName} ·
              collected by {record.collectedByName}
            </span>
          </>
        }
        actions={
          <>
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
          </>
        }
      />

      {isAdjustment && record.adjustsCollectionId ? (
        <FormMessage tone="info">
          This is a correction.{" "}
          <Link
            href={`/collections/${record.adjustsCollectionId}`}
            className="font-medium underline"
          >
            Open the collection it corrects
          </Link>
          .
        </FormMessage>
      ) : null}
      {pending ? (
        <FormMessage tone="info">
          A correction to {signedAmount(pending)} is awaiting approval; nothing
          has moved yet.{" "}
          {pending.approval?.canDecide ? (
            <Link
              href="/collections/pending-approval"
              className="font-medium underline"
            >
              Decide it in Pending approvals
            </Link>
          ) : null}
        </FormMessage>
      ) : null}

      <StatGrid columns={isAdjustment ? 2 : 4}>
        <Stat label="Recorded">{signedAmount(record)}</Stat>
        {!isAdjustment ? (
          <Stat label="Stands at">{formatCurrency(record.netAmount)}</Stat>
        ) : null}
        {!isAdjustment ? (
          <Stat label="Expected that day">
            {formatCurrency(record.expectedAmount)}
          </Stat>
        ) : null}
        <Stat label="Account outstanding">
          {formatCurrency(record.account.outstandingAmount)}
        </Stat>
      </StatGrid>
      {record.note ? (
        <p className="text-body text-ink-muted">Note: {record.note}</p>
      ) : null}

      {!isAdjustment ? (
        <Section title="Corrections">
          {record.adjustments.length === 0 ? (
            <p className="text-body text-ink-muted">
              None. The collection stands as recorded.
            </p>
          ) : (
            <DataView
              caption="Corrections"
              rows={record.adjustments}
              getRowId={(adjustment) => adjustment.id}
              complete
              columns={[
                valueColumn<Adjustment>({
                  id: "requested",
                  header: "Requested",
                  value: (adjustment) => adjustment.businessDate,
                  cell: (adjustment) =>
                    formatBusinessDate(adjustment.businessDate),
                }),
                moneyColumn<Adjustment>({
                  id: "change",
                  header: "Change",
                  amount: (adjustment) => adjustment.amount,
                  render: (adjustment) => (
                    <span className="tabular-nums" data-numeric>
                      {signedAmount(adjustment)}
                    </span>
                  ),
                }),
                displayColumn<Adjustment>({
                  id: "why",
                  header: "Why",
                  cell: (adjustment) =>
                    adjustment.approval ? (
                      <span className="flex flex-col">
                        {adjustment.approval.reason}
                        <span className="text-2xs text-ink-muted">
                          asked by {adjustment.approval.requestedByName}
                        </span>
                      </span>
                    ) : null,
                }),
                displayColumn<Adjustment>({
                  id: "decision",
                  header: "Decision",
                  align: "end",
                  cell: (adjustment) =>
                    adjustment.approval ? (
                      <span className="flex flex-col items-end gap-1">
                        <StatusBadge
                          kind="decision"
                          value={adjustment.approval.decision}
                        />
                        {adjustment.approval.decidedByName ? (
                          <span className="text-2xs text-ink-muted">
                            by {adjustment.approval.decidedByName}
                            {adjustment.approval.decisionNote
                              ? ` — ${adjustment.approval.decisionNote}`
                              : ""}
                          </span>
                        ) : null}
                      </span>
                    ) : null,
                }),
              ]}
            />
          )}
        </Section>
      ) : (
        <p className="flex items-center gap-2 text-body text-ink-muted">
          With this correction the collection reads as{" "}
          <StatusBadge kind="classification" value={record.classification} />
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

interface RequestDialogProps {
  record: CollectionDetail;
  onClose: () => void;
  onRequested: () => void;
}

/**
 * Request a correction (a Senior: what was actually collected) or a reversal
 * (an Admin: to ₹0). Either way it waits for approval — a Senior may decide
 * their own, an Admin's reversal needs another Admin (US-044). Each
 * kind is its own form over its own contract body.
 */
function RequestDialog({
  kind,
  ...props
}: RequestDialogProps & { kind: "correct" | "reverse" }) {
  return kind === "correct" ? (
    <CorrectionDialog {...props} />
  ) : (
    <ReversalDialog {...props} />
  );
}

function ReasonField() {
  return (
    <FormField
      name="reason"
      label="Reason"
      hint="Required. The approver sees it."
    >
      <Textarea rows={3} maxLength={500} />
    </FormField>
  );
}

function CorrectionDialog({
  record,
  onClose,
  onRequested,
}: RequestDialogProps) {
  const form = useZodForm(collectionContract.requestCorrection.body, {
    defaultValues: { correctedAmount: record.netAmount, reason: "" },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Request a correction of ${record.accountCode}`}
      description={`It stands at ${formatCurrency(record.netAmount)}. Enter what was actually collected. Nothing changes until another approver agrees.`}
      submitLabel="Request correction"
      pendingLabel="Sending…"
      onSubmit={async (body) => {
        const result = await apiWrite(collectionContract.requestCorrection, {
          params: { collectionId: record.id },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["correctedAmount", "reason"],
          });
        }
        toast({ title: `Correction of ${record.accountCode} requested` });
        onRequested();
      }}
    >
      <FormField name="correctedAmount" label="Actually collected (₹)">
        <Input inputMode="decimal" autoComplete="off" data-numeric />
      </FormField>
      <ReasonField />
    </DialogForm>
  );
}

function ReversalDialog({ record, onClose, onRequested }: RequestDialogProps) {
  const form = useZodForm(collectionContract.requestReversal.body, {
    defaultValues: { reason: "" },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Reverse ${formatCurrency(record.netAmount)} collected from ${record.customerName}`}
      description="The collection goes to ₹0 and the outstanding rises by the same, once another approver agrees. Both records stay in history."
      submitLabel="Request reversal"
      pendingLabel="Sending…"
      tone="danger"
      onSubmit={async (body) => {
        const result = await apiWrite(collectionContract.requestReversal, {
          params: { collectionId: record.id },
          body,
        });
        if (!result.ok)
          return applyWriteFailure(form.setError, result, {
            fields: ["reason"],
          });
        toast({ title: `Reversal of ${record.accountCode} requested` });
        onRequested();
      }}
    >
      <ReasonField />
    </DialogForm>
  );
}
