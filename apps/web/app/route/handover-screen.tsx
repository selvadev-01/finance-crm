"use client";

import { CaretLeft, CloudSlash } from "@phosphor-icons/react/dist/ssr";
import {
  cashContract,
  type CashPosition,
  type Handover,
} from "@repo/contracts";
import {
  Badge,
  Button,
  Field,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Textarea,
} from "@repo/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { apiWrite } from "../../lib/api-write";
import {
  countedTotal,
  countsBody,
  DenominationCount,
  difference,
  emptyCounts,
} from "../../lib/denomination-count";
import { backToRoute } from "./hash-view";

type Item = CashPosition["items"][number];

/**
 * S-06 on the Junior's phone — hand the day's cash to the Senior, counted note
 * by note (US-061). Needs signal: the Senior acknowledges online, standing
 * there (decided 2026-09-14). A count that differs from what Rasi recorded is
 * submitted with a note, never refused.
 */
export function HandoverScreen({
  connected,
  unsent,
}: {
  connected: boolean;
  unsent: number;
}) {
  const [position, setPosition] = useState<CashPosition | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api(cashContract.getCashPosition, {});
      if (result.ok) {
        setPosition(result.body);
        setProblem(null);
      } else {
        setProblem("Could not load your cash. Try again.");
      }
    } catch {
      setProblem("No signal. Connect to hand over cash.");
    }
  }, []);

  useEffect(() => {
    // Loading the position is the external read this effect synchronises with.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, connected]);

  return (
    <div
      className="flex flex-col gap-[var(--stack-gap)]"
      data-testid="handover"
    >
      <div>
        <Button tone="ghost" onClick={backToRoute} className="-ml-3">
          <CaretLeft aria-hidden size={20} weight="regular" />
          Route
        </Button>
      </div>
      <h1 className="text-xl font-semibold text-ink">Hand over cash</h1>

      {!connected ? (
        <FormMessage tone="info">
          <span className="flex items-center gap-2">
            <CloudSlash aria-hidden size={18} weight="regular" />
            Connect to hand over cash — your Senior acknowledges it online.
          </span>
        </FormMessage>
      ) : null}
      {unsent > 0 ? (
        <FormMessage tone="critical">
          {unsent} {unsent === 1 ? "collection is" : "collections are"} still on
          this phone. Send them first, so your count matches what the office
          has.
        </FormMessage>
      ) : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}

      {position === null && !problem ? (
        <p className="text-ink-muted" role="status">
          Loading your cash…
        </p>
      ) : null}
      {position && position.items.length === 0 ? (
        <p className="rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4 text-ink">
          Nothing to hand over. Cash you collect appears here once it reaches
          the office.
        </p>
      ) : null}
      {position?.items.map((item) => (
        <HandoverCard
          key={`${item.lineId}:${item.businessDate}`}
          item={item}
          disabled={!connected}
          onSent={() => void load()}
        />
      ))}

      {position && position.recent.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-ink">Recent handovers</h2>
          <ul className="flex flex-col gap-2">
            {position.recent.map((handover) => (
              <RecentRow key={handover.id} handover={handover} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function HandoverCard({
  item,
  disabled,
  onSent,
}: {
  item: Item;
  disabled: boolean;
  onSent: () => void;
}) {
  const [counts, setCounts] = useState(emptyCounts);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A second tap must not submit a second handover.
  const inFlight = useRef(false);
  const declared = countedTotal(counts);
  const diff = difference(declared, item.toHandOver);
  const matches = /^-?0\.00$/.test(diff);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setProblem(null);
    const result = await apiWrite(cashContract.handOver, {
      body: {
        lineId: item.lineId,
        businessDate: item.businessDate,
        counts: countsBody(counts),
        ...(note.trim() ? { note } : {}),
      },
    });
    inFlight.current = false;
    setSaving(false);
    if (!result.ok)
      return setProblem(
        result.fields["note"] ?? result.form ?? "Not handed over. Try again.",
      );
    setCounts(emptyCounts());
    setNote("");
    onSent();
  }

  return (
    <section
      className="flex flex-col gap-[var(--stack-gap)] rounded-[var(--radius-surface)] border border-border bg-surface-raised p-4"
      data-testid={`cash-${item.businessDate}`}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold text-ink">
          {formatBusinessDate(item.businessDate)} · {item.lineName}
        </h2>
        <p className="text-sm text-ink-muted" data-numeric>
          Recorded {formatCurrency(item.toHandOver)} · to{" "}
          {item.receiver?.name ?? "no Senior assigned"}
        </p>
      </div>

      {item.pending ? (
        <div className="flex flex-col gap-1">
          <p className="text-base text-ink" data-numeric>
            Handed over {formatCurrency(item.pending.declaredAmount)} — waiting
            for {item.pending.toName} to acknowledge.
          </p>
          <Badge tone="warning" className="w-fit text-ink">
            <span aria-hidden className="size-2 rounded-full bg-warning" />
            Waiting
          </Badge>
        </div>
      ) : !item.receiver ? (
        <FormMessage tone="critical">
          No Senior is assigned to this line for that day. Ask an Admin.
        </FormMessage>
      ) : (
        <>
          <DenominationCount
            counts={counts}
            onChange={setCounts}
            disabled={disabled || saving}
          />
          <div
            className="flex items-baseline justify-between gap-2"
            data-numeric
          >
            <span className="text-lg font-semibold text-ink">
              Counted {formatCurrency(declared)}
            </span>
            <span className="text-sm">
              {matches ? (
                <span className="text-positive">Matches</span>
              ) : diff.startsWith("-") ? (
                <span className="font-medium text-critical">
                  {formatCurrency(diff.slice(1))} short
                </span>
              ) : (
                <span className="font-medium text-ink">
                  {formatCurrency(diff)} over
                </span>
              )}
            </span>
          </div>
          {!matches ? (
            <Field
              label="Why the count differs"
              hint="Required. Your Senior sees it."
            >
              <Textarea
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          ) : null}
          {problem ? (
            <FormMessage tone="critical">{problem}</FormMessage>
          ) : null}
          <Button
            tone="primary"
            onClick={() => void submit()}
            disabled={disabled || saving || declared === "0.00"}
          >
            {saving
              ? "Handing over…"
              : `Hand ${formatCurrency(declared)} to ${item.receiver.name}`}
          </Button>
        </>
      )}
    </section>
  );
}

function RecentRow({ handover }: { handover: Handover }) {
  return (
    <li className="flex flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-[var(--row-padding-y)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink">
          {formatBusinessDate(handover.businessDate)} · to {handover.toName}
        </span>
        <span className="text-base font-semibold text-ink" data-numeric>
          {formatCurrency(handover.declaredAmount)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {handover.status === "ACKNOWLEDGED" ? (
          <Badge tone="positive">Acknowledged</Badge>
        ) : handover.status === "DISPUTED" ? (
          <Badge tone="critical">Disputed — count again</Badge>
        ) : (
          <Badge tone="warning" className="text-ink">
            Waiting
          </Badge>
        )}
      </div>
      {handover.disputeNote ? (
        <p className="text-sm text-critical">{handover.disputeNote}</p>
      ) : null}
    </li>
  );
}
