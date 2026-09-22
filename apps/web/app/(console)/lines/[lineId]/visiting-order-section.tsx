"use client";

import { ArrowDown, ArrowUp } from "@phosphor-icons/react/dist/ssr";
import {
  organisationContract as org,
  type VisitingOrder,
} from "@repo/contracts";
import {
  Badge,
  Button,
  FormMessage,
  NothingYet,
  Section,
  Skeleton,
  toast,
} from "@repo/ui";
import { useState } from "react";

import { LoadFailed } from "../../../../components/query-state";
import { apiWrite } from "../../../../lib/api-write";
import { useApiQuery } from "../../../../lib/use-api-query";

type Customer = VisitingOrder["customers"][number];

/**
 * US-040 — the order the Junior visits this line's customers in, set here by
 * the line's Senior or an Admin (decided 2026-09-21). Moved with up and down
 * buttons rather than drag, so it works with a keyboard and on a phone, and
 * saved as a whole: the API refuses a list that is not exactly the line's
 * customers, so a customer who joined meanwhile is never dropped.
 */
export function VisitingOrderSection({ lineId }: { lineId: string }) {
  const order = useApiQuery(org.getVisitingOrder, { params: { lineId } });
  const [draft, setDraft] = useState<Customer[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const saved = order.status === "ready" ? order.data.customers : [];
  const shown = draft ?? saved;
  const unplaced = saved.filter((customer) => customer.position === null);

  function move(index: number, by: -1 | 1) {
    const next = [...shown];
    const [customer] = next.splice(index, 1);
    next.splice(index + by, 0, customer!);
    setDraft(next);
    setProblem(null);
  }

  // A move to save, or someone still unplaced — saving as shown places them.
  const canSave = draft !== null || unplaced.length > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    const result = await apiWrite(org.setVisitingOrder, {
      params: { lineId },
      body: { customerIds: shown.map((customer) => customer.customerId) },
    });
    setSaving(false);
    if (!result.ok) {
      setProblem(result.form ?? "The order was not saved. Try again.");
      if (result.code === "VISITING_ORDER_MISMATCH") order.reload();
      return;
    }
    setDraft(null);
    setProblem(null);
    order.reload();
    toast({ tone: "positive", title: "Visiting order saved" });
  }

  return (
    <Section
      title="Visiting order"
      actions={
        canSave && shown.length > 0 ? (
          <>
            {draft ? (
              <Button onClick={() => setDraft(null)} disabled={saving}>
                Discard
              </Button>
            ) : null}
            <Button
              tone="primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save order"}
            </Button>
          </>
        ) : null
      }
    >
      <p className="text-body text-ink-muted">
        The order the Junior’s route lists customers in, first visit first.
        {unplaced.length > 0 && !draft
          ? ` ${unplaced.length} not yet placed ${unplaced.length === 1 ? "is" : "are"} at the end; saving places everyone.`
          : ""}
      </p>
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      {order.status === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : order.status === "error" ? (
        <LoadFailed message={order.message} onRetry={order.reload} />
      ) : shown.length === 0 ? (
        <NothingYet
          title="No customers on this line yet"
          description="Customers appear here as they are onboarded to the line, ready to be put in order."
        />
      ) : (
        <ol
          className="flex flex-col divide-y divide-border rounded-surface border border-border bg-surface-raised"
          aria-label="Visiting order"
          data-testid="visiting-order"
        >
          {shown.map((customer, index) => (
            <li
              key={customer.customerId}
              className="flex items-center gap-3 px-3 py-2"
            >
              <span
                className="w-8 shrink-0 text-right text-label text-ink-muted"
                data-numeric
              >
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-medium text-ink">
                  {customer.name}
                </span>
                <span className="truncate text-caption text-ink-muted">
                  <span className="font-mono">{customer.customerCode}</span> ·{" "}
                  {customer.address}
                </span>
              </span>
              {customer.position === null && !draft ? (
                <Badge tone="warning">Not placed</Badge>
              ) : null}
              <Button
                tone="ghost"
                onClick={() => move(index, -1)}
                disabled={index === 0 || saving}
                aria-label={`Move ${customer.name} up`}
                className="px-2"
              >
                <ArrowUp aria-hidden size={18} weight="regular" />
              </Button>
              <Button
                tone="ghost"
                onClick={() => move(index, 1)}
                disabled={index === shown.length - 1 || saving}
                aria-label={`Move ${customer.name} down`}
                className="px-2"
              >
                <ArrowDown aria-hidden size={18} weight="regular" />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
