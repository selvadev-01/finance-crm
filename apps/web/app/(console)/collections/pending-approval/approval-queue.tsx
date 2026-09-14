"use client";

import { type ApprovalQueueItem, collectionContract } from "@repo/contracts";
import {
  Button,
  DataTableSkeleton,
  formatBusinessDate,
  formatCurrency,
  NothingYet,
  NotPermitted,
  PageHeader,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { useApiQuery } from "../../../../lib/use-api-query";
import { useSignedIn } from "../../../../lib/use-me";
import { LIST_LIMIT, LoadFailed, Surface, TruncatedNote } from "../../_organisation/list-controls";
import { canApproveCorrections, DecisionDialog, signedAmount } from "../collection-parts";

/**
 * S-18 · Pending approvals — an action queue. Each correction shows what was
 * recorded, what it becomes and why; approving or rejecting is one dialog.
 * **Self-approval is blocked:** a request of your own says so instead of
 * offering the buttons, and the API refuses it regardless.
 */
export function ApprovalQueue() {
  const me = useSignedIn();
  const allowed = canApproveCorrections(me.role);
  const [deciding, setDeciding] = useState<{ item: ApprovalQueueItem; decision: "APPROVED" | "REJECTED" } | null>(null);
  const queue = useApiQuery(
    collectionContract.listApprovals,
    allowed ? { query: { limit: LIST_LIMIT, decision: "PENDING" } } : null,
  );

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/collections" className="hover:text-ink hover:underline">Collections</Link>}
        title="Pending approvals"
        description="Corrections wait here until someone other than the requester approves or rejects them. Nothing moves until then."
      />

      {!allowed ? (
        <Surface>
          <NotPermitted title="Approvals are for Seniors and Admins" description="Corrections you request are decided by your Senior." />
        </Surface>
      ) : null}
      {queue.status === "loading" ? <DataTableSkeleton columns={4} rows={3} /> : null}
      {queue.status === "error" ? <LoadFailed message={queue.message} onRetry={queue.reload} /> : null}
      {queue.status === "ready" && queue.data.data.length === 0 ? (
        <Surface>
          <NothingYet title="Nothing waiting" description="Corrections requested on your line or organisation appear here." />
        </Surface>
      ) : null}

      {queue.status === "ready" && queue.data.data.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="Corrections awaiting a decision">
          {queue.data.data.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4"
              data-testid="approval"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/collections/${item.original.id}`}
                    className="font-medium text-ink hover:text-accent hover:underline"
                  >
                    {item.adjustment.customerName}
                  </Link>
                  <span className="text-sm text-ink-muted">
                    <span className="font-mono">{item.adjustment.accountCode}</span> · {item.adjustment.lineName} · collected{" "}
                    {formatBusinessDate(item.original.businessDate)} by {item.adjustment.collectedByName}
                  </span>
                </div>
                <p className="flex items-baseline gap-2 text-base text-ink" data-numeric>
                  <span className="text-ink-muted line-through">{formatCurrency(item.original.netAmount)}</span>
                  <span className="font-semibold">{formatCurrency(item.correctedAmount)}</span>
                  <span className="text-sm text-ink-muted">({signedAmount(item.adjustment)})</span>
                </p>
              </div>
              <blockquote className="border-l-2 border-border-strong pl-3 text-sm text-ink">{item.reason}</blockquote>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-ink-muted">Requested by {item.requestedByName}</span>
                {item.canDecide ? (
                  <span className="flex gap-2">
                    <Button tone="secondary" onClick={() => setDeciding({ item, decision: "REJECTED" })}>
                      Reject
                    </Button>
                    <Button tone="primary" onClick={() => setDeciding({ item, decision: "APPROVED" })}>
                      Approve
                    </Button>
                  </span>
                ) : (
                  <span className="text-sm text-ink-muted">You requested this — another approver decides it.</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {queue.status === "ready" && queue.data.hasMore ? <TruncatedNote noun="corrections" /> : null}

      {deciding ? (
        <DecisionDialog
          item={deciding.item}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDecided={() => {
            setDeciding(null);
            queue.reload();
          }}
        />
      ) : null}
    </>
  );
}
