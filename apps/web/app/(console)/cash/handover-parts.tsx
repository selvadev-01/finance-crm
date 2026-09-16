"use client";

import { cashContract, type CashPosition, type Handover } from "@repo/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  Field,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Select,
  Textarea,
} from "@repo/ui";
import { useState } from "react";

import { apiWrite } from "../../../lib/api-write";
import {
  countedTotal,
  countsBody,
  DenominationCount,
  difference,
  emptyCounts,
} from "../../../lib/denomination-count";

export function HandoverStatusBadge({ status }: { status: Handover["status"] }) {
  if (status === "ACKNOWLEDGED") return <Badge tone="positive">Acknowledged</Badge>;
  if (status === "DISPUTED") return <Badge tone="critical">Disputed</Badge>;
  return <Badge tone="warning">Waiting</Badge>;
}

/** `+₹20.00` / `−₹20.00` / `Matches`. */
export function DiscrepancyText({ amount }: { amount: string }) {
  if (/^-?0\.00$/.test(amount)) return <span className="text-positive">Matches</span>;
  return amount.startsWith("-") ? (
    <span className="font-medium text-critical">−{formatCurrency(amount.slice(1))} short</span>
  ) : (
    <span className="font-medium text-ink">+{formatCurrency(amount)} over</span>
  );
}

/**
 * Handovers with what the caller may do (US-062, US-063). Each row opens its
 * denomination breakdown (US-065: "one ₹200 note short" is on the page).
 */
export function HandoverList({ handovers, onChanged }: { handovers: Handover[]; onChanged: () => void }) {
  const [acting, setActing] = useState<{ handover: Handover; action: "acknowledge" | "dispute" } | null>(null);

  if (handovers.length === 0) {
    return <p className="text-sm text-ink-muted">No handovers yet.</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {handovers.map((handover) => (
          <li
            key={handover.id}
            className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3"
            data-testid="handover"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium text-ink">
                  {handover.fromName} → {handover.hop === "SENIOR_TO_OFFICE" ? `office (${handover.toName})` : handover.toName}
                </span>
                <span className="text-sm text-ink-muted">
                  {handover.lineName} · {formatBusinessDate(handover.businessDate)}
                </span>
              </div>
              <span className="flex flex-col items-end gap-1 text-sm" data-numeric>
                <span className="text-base font-semibold text-ink">{formatCurrency(handover.declaredAmount)}</span>
                <span className="text-ink-muted">
                  recorded {formatCurrency(handover.systemAmount)} · <DiscrepancyText amount={handover.discrepancy} />
                </span>
              </span>
            </div>
            {handover.note ? <p className="text-sm text-ink">“{handover.note}”</p> : null}
            {handover.disputeNote ? <p className="text-sm text-critical">Disputed: {handover.disputeNote}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <HandoverStatusBadge status={handover.status} />
              <span className="flex gap-2">
                {handover.canDispute ? (
                  <Button tone="secondary" onClick={() => setActing({ handover, action: "dispute" })}>
                    Dispute
                  </Button>
                ) : null}
                {handover.canAcknowledge ? (
                  <Button tone="primary" onClick={() => setActing({ handover, action: "acknowledge" })}>
                    Acknowledge
                  </Button>
                ) : null}
              </span>
            </div>
            <details className="text-sm">
              <summary className="flex min-h-[var(--control-height)] cursor-pointer items-center text-ink-muted">
                Denominations
              </summary>
              <table className="w-full max-w-sm text-sm" data-numeric>
                <tbody>
                  {handover.denominations
                    .filter((row) => row.count > 0)
                    .map((row) => (
                      <tr key={row.denomination} className="border-t border-border">
                        <td className="py-1">₹{row.denomination}</td>
                        <td className="py-1 text-right">× {row.count}</td>
                        <td className="py-1 text-right">{formatCurrency(row.subtotal)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </li>
        ))}
      </ul>
      {acting ? (
        <ActOnHandover
          handover={acting.handover}
          action={acting.action}
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function ActOnHandover({
  handover,
  action,
  onClose,
  onDone,
}: {
  handover: Handover;
  action: "acknowledge" | "dispute";
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setProblem(null);
    const result =
      action === "acknowledge"
        ? await apiWrite(cashContract.acknowledgeHandover, { params: { handoverId: handover.id }, body: {} })
        : await apiWrite(cashContract.disputeHandover, { params: { handoverId: handover.id }, body: { note } });
    setPending(false);
    if (!result.ok) return setProblem(result.fields["note"] ?? result.form ?? "Not saved.");
    onDone();
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={
        action === "acknowledge"
          ? `Acknowledge ${formatCurrency(handover.declaredAmount)} from ${handover.fromName}`
          : `Dispute ${formatCurrency(handover.declaredAmount)} from ${handover.fromName}`
      }
      description={
        action === "acknowledge"
          ? `You confirm you are holding this cash now. It moves from ${handover.fromName}'s cash in hand to ${handover.hop === "SENIOR_TO_OFFICE" ? "the office" : "yours"}, and cannot be disputed afterwards.`
          : `Nothing moves. ${handover.fromName} counts again and submits a new handover.`
      }
    >
      {action === "dispute" ? (
        <Field label="What is wrong" hint="Say what you counted — “one ₹200 note short”.">
          <Textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      ) : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button tone={action === "dispute" ? "danger" : "primary"} onClick={() => void submit()} disabled={pending}>
          {pending ? "Saving…" : action === "acknowledge" ? "I have the cash" : "Dispute"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** US-064: a Senior counts the day's cash for the office and picks the Admin. */
export function HandToOfficeDialog({
  item,
  receivers,
  onClose,
  onDone,
}: {
  item: CashPosition["items"][number];
  receivers: CashPosition["officeReceivers"];
  onClose: () => void;
  onDone: () => void;
}) {
  const [counts, setCounts] = useState(emptyCounts);
  const [toUserId, setToUserId] = useState(receivers[0]?.userId ?? "");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const declared = countedTotal(counts);
  const diff = difference(declared, item.toHandOver);
  const matches = /^-?0\.00$/.test(diff);

  async function submit() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(cashContract.handOver, {
      body: {
        lineId: item.lineId,
        businessDate: item.businessDate,
        toUserId,
        counts: countsBody(counts),
        ...(note.trim() ? { note } : {}),
      },
    });
    setPending(false);
    if (!result.ok) return setProblem(result.fields["note"] ?? result.form ?? "Not saved.");
    onDone();
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={`Hand ${item.lineName}'s cash for ${formatBusinessDate(item.businessDate)} to the office`}
      description={`Recorded: ${formatCurrency(item.toHandOver)}. Count what you are handing over; the Admin acknowledges it.`}
    >
      <Field label="Admin receiving">
        <Select value={toUserId} onChange={(event) => setToUserId(event.target.value)}>
          {receivers.map((receiver) => (
            <option key={receiver.userId} value={receiver.userId}>
              {receiver.name}
            </option>
          ))}
        </Select>
      </Field>
      <DenominationCount counts={counts} onChange={setCounts} disabled={pending} />
      <p className="flex justify-between text-base" data-numeric>
        <span className="font-semibold text-ink">Counted {formatCurrency(declared)}</span>
        <DiscrepancyText amount={diff} />
      </p>
      {!matches ? (
        <Field label="Why the count differs" hint="Required when the count differs from what was recorded.">
          <Textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      ) : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button tone="primary" onClick={() => void submit()} disabled={pending || !toUserId}>
          {pending ? "Saving…" : `Hand over ${formatCurrency(declared)}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
