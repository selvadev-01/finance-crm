"use client";

import { type ApprovalQueueItem, collectionContract } from "@repo/contracts";
import {
  Button,
  Card,
  Description,
  DescriptionList,
  EmptyFrame,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  ListFooter,
  NothingYet,
  NotPermitted,
  PageHeader,
  RecordIdentity,
  recordLinkClass,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { ListFallback } from "../../../../components/list-state";
import { PageTrail } from "../../../../components/page-trail";
import { LIST_LIMIT } from "../../../../lib/list-limit";
import { useSignedIn } from "../../../../lib/use-me";
import { usePagedQuery } from "../../../../lib/use-paged-query";
import {
  canApproveCorrections,
  DecisionDialog,
  signedAmount,
} from "../collection-parts";

/**
 * S-18 · Pending approvals — an action queue. Each correction shows what was
 * recorded, what it becomes and why; approving or rejecting is one dialog.
 * **Self-approval is blocked:** a request of your own says so instead of
 * offering the buttons, and the API refuses it regardless.
 */
export function ApprovalQueue() {
  const me = useSignedIn();
  const allowed = canApproveCorrections(me.role);
  const [deciding, setDeciding] = useState<{
    item: ApprovalQueueItem;
    decision: "APPROVED" | "REJECTED";
  } | null>(null);
  const queue = usePagedQuery(
    collectionContract.listApprovals,
    allowed ? { query: { limit: LIST_LIMIT, decision: "PENDING" } } : null,
  );

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: "Collections", href: "/collections" },
              { label: "Pending approvals" },
            ]}
          />
        }
        title="Pending approvals"
        description="Corrections wait here until someone other than the requester approves or rejects them. Nothing moves until then."
      />

      {!allowed ? (
        <EmptyFrame>
          <NotPermitted
            title="Approvals are for Seniors and Admins"
            description="Corrections you request are decided by your Senior."
          />
        </EmptyFrame>
      ) : queue.status === "ready" && queue.rows.length > 0 ? (
        <>
          <ul
            className="flex flex-col gap-3"
            aria-label="Corrections awaiting a decision"
          >
            {queue.rows.map((item) => (
              <li key={item.id} data-testid="approval">
                <ApprovalCard
                  item={item}
                  onDecide={(decision) => setDeciding({ item, decision })}
                />
              </li>
            ))}
          </ul>
          <ListFooter
            shown={queue.rows.length}
            noun={queue.rows.length === 1 ? "correction" : "corrections"}
            onMore={queue.loadMore}
            loadingMore={queue.loadingMore}
          />
          {queue.moreError ? (
            <FormMessage tone="critical">{queue.moreError}</FormMessage>
          ) : null}
        </>
      ) : (
        <ListFallback
          query={queue}
          columns={4}
          empty={
            <NothingYet
              title="Nothing waiting"
              description="Corrections requested on your line or organisation appear here."
            />
          }
        />
      )}

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

/** One correction awaiting a decision: whose, from what to what, and why. */
function ApprovalCard({
  item,
  onDecide,
}: {
  item: ApprovalQueueItem;
  onDecide: (decision: "APPROVED" | "REJECTED") => void;
}) {
  return (
    <Card.Root>
      <Card.Body>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <RecordIdentity code={item.adjustment.accountCode}>
            <Link
              href={`/collections/${item.original.id}`}
              className={recordLinkClass}
            >
              {item.adjustment.customerName}
            </Link>
          </RecordIdentity>
          <p
            className="flex items-baseline gap-2 text-heading text-ink"
            data-numeric
          >
            <span className="font-normal text-ink-muted line-through">
              {formatCurrency(item.original.netAmount)}
            </span>
            <span>{formatCurrency(item.correctedAmount)}</span>
            <span className="text-caption text-ink-muted">
              ({signedAmount(item.adjustment)})
            </span>
          </p>
        </div>
        <DescriptionList layout="columns">
          <Description term="Line">{item.adjustment.lineName}</Description>
          <Description term="Collected">
            {formatBusinessDate(item.original.businessDate)} by{" "}
            {item.adjustment.collectedByName}
          </Description>
          <Description term="Requested by">{item.requestedByName}</Description>
        </DescriptionList>
        <blockquote className="border-l-2 border-border-strong pl-3 text-body text-ink">
          {item.reason}
        </blockquote>
      </Card.Body>
      <Card.Footer>
        {item.canDecide ? (
          <>
            <Button tone="secondary" onClick={() => onDecide("REJECTED")}>
              Reject
            </Button>
            <Button tone="primary" onClick={() => onDecide("APPROVED")}>
              Approve
            </Button>
          </>
        ) : (
          <span className="text-body text-ink-muted">
            You requested this — another approver decides it.
          </span>
        )}
      </Card.Footer>
    </Card.Root>
  );
}
