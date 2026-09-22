"use client";

import {
  ArrowRight,
  CloudSlash,
  Hourglass,
  Wallet,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import {
  cashContract,
  type CashPosition,
  type Handover,
} from "@repo/contracts";
import {
  Badge,
  Button,
  cn,
  Field,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Skeleton,
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
import { Banner, cardClass, FieldPage, Section } from "./app-chrome";
import { openView } from "./hash-view";

type Item = CashPosition["items"][number];

/**
 * J-05 · Cash (S-06 on the Junior's phone, US-061) — hand the day's cash to
 * the Senior, counted note by note. Needs signal: the Senior acknowledges
 * online, standing there (decided 2026-09-14). A count that differs from what
 * Rasi recorded is submitted with a note, never refused.
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
    <FieldPage title="Cash" testId="handover">
      {!connected ? (
        <Banner tone="neutral" icon={<CloudSlash size={20} weight="regular" />}>
          Connect to hand over cash — your Senior acknowledges it online.
        </Banner>
      ) : null}
      {unsent > 0 ? (
        <Banner
          tone="critical"
          icon={<Warning size={20} weight="regular" />}
          action={
            <Button
              tone="ghost"
              onClick={() => openView("#sync")}
              className="rounded-pill font-semibold text-critical hover:text-critical"
            >
              Open Sync
            </Button>
          }
        >
          {unsent} {unsent === 1 ? "collection is" : "collections are"} still on
          this phone. Send them first, so your count matches what the office
          has.
        </Banner>
      ) : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}

      {position === null && !problem ? (
        <div
          role="status"
          aria-label="Loading your cash"
          className="flex flex-col gap-3"
        >
          <Skeleton className="h-24 rounded-overlay" />
          <Skeleton className="h-72 rounded-overlay" />
        </div>
      ) : null}
      {position && position.items.length === 0 ? (
        <div
          className={cn(
            cardClass,
            "flex flex-col items-center gap-3 px-6 py-10 text-center",
          )}
        >
          <span
            aria-hidden
            className="flex size-16 items-center justify-center rounded-pill bg-accent-subtle text-accent"
          >
            <Wallet size={28} weight="regular" />
          </span>
          <p className="text-lg font-semibold text-ink">Nothing to hand over</p>
          <p className="text-base text-ink-muted">
            Cash you collect appears here once it reaches the office.
          </p>
        </div>
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
        <Section title="Recent handovers">
          <ul className="flex flex-col gap-2">
            {position.recent.map((handover) => (
              <RecentRow key={handover.id} handover={handover} />
            ))}
          </ul>
        </Section>
      ) : null}
    </FieldPage>
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
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // A second tap must not submit a second handover.
  const inFlight = useRef(false);
  const declared = countedTotal(counts);
  const diff = difference(declared, item.toHandOver);
  const matches = /^-?0\.00$/.test(diff);

  async function submit() {
    if (inFlight.current) return;
    // US-061: a count that differs needs a reason. Ask for it here rather than
    // sending a request the API is bound to refuse.
    if (!matches && !note.trim()) {
      setNoteError("Say why the count differs before handing over.");
      noteRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setProblem(null);
    setNoteError(null);
    const result = await apiWrite(
      cashContract.handOver,
      {
        body: {
          lineId: item.lineId,
          businessDate: item.businessDate,
          counts: countsBody(counts),
          ...(note.trim() ? { note } : {}),
        },
      },
      { fields: { note: "Note" } },
    );
    inFlight.current = false;
    setSaving(false);
    if (!result.ok) {
      if (result.fields["note"]) {
        setNoteError(result.fields["note"]);
        noteRef.current?.focus();
        return;
      }
      return setProblem(result.form ?? "Not handed over. Try again.");
    }
    setCounts(emptyCounts());
    setNote("");
    onSent();
  }

  return (
    <section
      className="flex flex-col gap-3"
      data-testid={`cash-${item.businessDate}`}
    >
      <div
        className={cn(cardClass, "flex items-start justify-between gap-3 p-4")}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-base font-semibold text-ink" data-numeric>
            {formatBusinessDate(item.businessDate)} · {item.lineName}
          </h2>
          <p className="text-sm text-ink-muted">
            To {item.receiver?.name ?? "no Senior assigned"}
          </p>
        </div>
        <p className="flex shrink-0 flex-col items-end" data-numeric>
          <span className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
            Recorded
          </span>{" "}
          <span className="text-xl font-semibold text-ink">
            {formatCurrency(item.toHandOver)}
          </span>
        </p>
      </div>

      {item.pending ? (
        <div className="flex items-start gap-3 rounded-overlay border border-warning-border bg-warning-subtle p-4">
          <Hourglass
            aria-hidden
            size={24}
            weight="regular"
            className="mt-0.5 shrink-0 text-warning"
          />
          <div className="flex flex-col gap-2">
            <p className="text-base font-medium text-ink" data-numeric>
              Handed over {formatCurrency(item.pending.declaredAmount)} —
              waiting for {item.pending.toName} to acknowledge.
            </p>
            <Badge tone="warning" shape="pill">
              Waiting
            </Badge>
          </div>
        </div>
      ) : !item.receiver ? (
        <FormMessage tone="critical">
          No Senior is assigned to this line for that day. Ask an Admin.
        </FormMessage>
      ) : (
        <>
          <div className={cn(cardClass, "overflow-hidden")}>
            <div
              aria-hidden
              className="flex items-center justify-between gap-3 border-b border-border bg-surface-sunken px-4 py-2 text-2xs font-semibold tracking-[0.08em] whitespace-nowrap text-ink-muted uppercase"
            >
              <span>Note</span>
              <span>Count</span>
              <span>Subtotal</span>
            </div>
            <div className="[&_li]:min-h-14 [&_li]:px-4 [&>ul]:rounded-none [&>ul]:border-0 [&_li_button]:size-11 [&_li_button]:rounded-pill [&_li_button]:border [&_li_button]:border-border-strong [&_li_button]:px-0 [&_li_input]:rounded-surface">
              <DenominationCount
                counts={counts}
                onChange={setCounts}
                disabled={disabled || saving}
              />
            </div>
          </div>
          {!matches ? (
            <Field
              label="Why the count differs"
              hint="Required. Your Senior sees it."
              {...(noteError ? { error: noteError } : {})}
              className="[&>label]:text-base [&>label]:font-medium"
            >
              <Textarea
                ref={noteRef}
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  if (noteError) setNoteError(null);
                }}
              />
            </Field>
          ) : null}
          {problem ? (
            <FormMessage tone="critical">{problem}</FormMessage>
          ) : null}
          {/* The total and the one action stay under the thumb while counting. */}
          <div
            className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-surface-raised px-4 py-3"
            data-numeric
          >
            <div className="flex items-center justify-between gap-3">
              <p className="flex flex-col">
                <span className="text-2xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
                  Counted
                </span>{" "}
                <span className="text-2xl font-semibold text-ink">
                  {formatCurrency(declared)}
                </span>
              </p>
              {matches ? (
                <Badge tone="positive" shape="pill">
                  Matches
                </Badge>
              ) : diff.startsWith("-") ? (
                <Badge tone="critical" shape="pill">
                  {formatCurrency(diff.slice(1))} short
                </Badge>
              ) : (
                <Badge tone="info" shape="pill">
                  {formatCurrency(diff)} over
                </Badge>
              )}
            </div>
            <Button
              tone="primary"
              onClick={() => void submit()}
              disabled={disabled || saving || declared === "0.00"}
              className="h-14 w-full rounded-pill text-lg font-semibold"
            >
              <span data-numeric>
                {saving
                  ? "Handing over…"
                  : `Hand ${formatCurrency(declared)} to ${item.receiver.name}`}
              </span>
              <ArrowRight aria-hidden size={20} weight="regular" />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function RecentRow({ handover }: { handover: Handover }) {
  return (
    <li className={cn(cardClass, "flex flex-col gap-1.5 px-4 py-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xl font-semibold text-ink" data-numeric>
          {formatCurrency(handover.declaredAmount)}
        </span>
        {handover.status === "ACKNOWLEDGED" ? (
          <Badge tone="positive" shape="pill">
            Acknowledged
          </Badge>
        ) : handover.status === "DISPUTED" ? (
          <Badge tone="critical" shape="pill">
            Disputed — count again
          </Badge>
        ) : (
          <Badge tone="warning" shape="pill">
            Waiting
          </Badge>
        )}
      </div>
      <span className="text-sm text-ink-muted" data-numeric>
        {formatBusinessDate(handover.businessDate)} · to {handover.toName}
      </span>
      {handover.disputeNote ? (
        <p className="text-sm text-critical">{handover.disputeNote}</p>
      ) : null}
    </li>
  );
}
