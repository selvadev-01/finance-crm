"use client";

import {
  cashContract,
  type CashPosition,
  type Handover,
} from "@repo/contracts";
import {
  Button,
  Card,
  DataView,
  Dialog,
  DialogActions,
  DialogForm,
  FormField,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Select,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { moneyColumn, valueColumn } from "../../../components/columns";
import { Discrepancy, Money } from "../../../components/money";
import { StatusBadge } from "../../../components/status-badge";
import { apiWrite } from "../../../lib/api-write";
import { applyWriteFailure } from "../../../lib/form-errors";
import {
  countedTotal,
  countsBody,
  DenominationCount,
  emptyCounts,
} from "../../../lib/denomination-count";
import { isZeroMoney, subtractMoney } from "../../../lib/money";

type Denomination = Handover["denominations"][number];

/**
 * Handovers with what the caller may do (US-062, US-063). Each row opens its
 * denomination breakdown (US-065: "one ₹200 note short" is on the page).
 */
export function HandoverList({
  handovers,
  onChanged,
}: {
  handovers: Handover[];
  onChanged: () => void;
}) {
  const [acting, setActing] = useState<{
    handover: Handover;
    action: "acknowledge" | "dispute";
  } | null>(null);

  if (handovers.length === 0) {
    return <p className="text-body text-ink-muted">No handovers yet.</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {handovers.map((handover) => (
          <li key={handover.id} data-testid="handover">
            <Card.Root>
              <Card.Body>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium text-ink">
                      {handover.fromName} →{" "}
                      {handover.hop === "SENIOR_TO_OFFICE"
                        ? `office (${handover.toName})`
                        : handover.toName}
                    </span>
                    <span className="text-caption text-ink-muted">
                      {handover.lineName} ·{" "}
                      {formatBusinessDate(handover.businessDate)}
                    </span>
                  </div>
                  <span
                    className="flex flex-col items-end gap-1 text-caption"
                    data-numeric
                  >
                    <Money
                      amount={handover.declaredAmount}
                      className="text-heading text-ink"
                    />
                    <span className="text-ink-muted">
                      recorded {formatCurrency(handover.systemAmount)} ·{" "}
                      <Discrepancy amount={handover.discrepancy} />
                    </span>
                  </span>
                </div>
                {handover.note ? (
                  <p className="text-body text-ink">“{handover.note}”</p>
                ) : null}
                {handover.disputeNote ? (
                  <p className="text-body text-critical">
                    Disputed: {handover.disputeNote}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge kind="handover" value={handover.status} />
                  <span className="flex gap-2">
                    {handover.canDispute ? (
                      <Button
                        tone="secondary"
                        onClick={() =>
                          setActing({ handover, action: "dispute" })
                        }
                      >
                        Dispute
                      </Button>
                    ) : null}
                    {handover.canAcknowledge ? (
                      <Button
                        tone="primary"
                        onClick={() =>
                          setActing({ handover, action: "acknowledge" })
                        }
                      >
                        Acknowledge
                      </Button>
                    ) : null}
                  </span>
                </div>
                <details className="text-body">
                  <summary className="flex min-h-[var(--control-height)] cursor-pointer items-center text-ink-muted">
                    Denominations
                  </summary>
                  <div className="max-w-sm">
                    <DataView
                      caption={`Denominations handed over by ${handover.fromName}`}
                      rows={handover.denominations.filter(
                        (row) => row.count > 0,
                      )}
                      getRowId={(row) => String(row.denomination)}
                      complete
                      columns={[
                        valueColumn<Denomination>({
                          id: "note",
                          header: "Note",
                          value: (row) => row.denomination,
                          cell: (row) => `₹${row.denomination}`,
                        }),
                        valueColumn<Denomination>({
                          id: "count",
                          header: "Count",
                          align: "end",
                          value: (row) => row.count,
                          cell: (row) => (
                            <span data-numeric>× {row.count}</span>
                          ),
                        }),
                        moneyColumn<Denomination>({
                          id: "subtotal",
                          header: "Subtotal",
                          amount: (row) => row.subtotal,
                        }),
                      ]}
                    />
                  </div>
                </details>
              </Card.Body>
            </Card.Root>
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

interface ActProps {
  handover: Handover;
  onClose: () => void;
  onDone: () => void;
}

function ActOnHandover({
  action,
  ...props
}: ActProps & { action: "acknowledge" | "dispute" }) {
  return action === "acknowledge" ? (
    <AcknowledgeHandover {...props} />
  ) : (
    <DisputeHandover {...props} />
  );
}

/** Nothing to fill in, so a plain confirming dialog. */
function AcknowledgeHandover({ handover, onClose, onDone }: ActProps) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(cashContract.acknowledgeHandover, {
      params: { handoverId: handover.id },
      body: {},
    });
    setPending(false);
    if (!result.ok) return setProblem(result.form ?? "Not saved.");
    onDone();
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={`Acknowledge ${formatCurrency(handover.declaredAmount)} from ${handover.fromName}`}
      description={`You confirm you are holding this cash now. It moves from ${handover.fromName}'s cash in hand to ${handover.hop === "SENIOR_TO_OFFICE" ? "the office" : "yours"}, and cannot be disputed afterwards.`}
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button tone="primary" onClick={() => void submit()} disabled={pending}>
          {pending ? "Saving…" : "I have the cash"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DisputeHandover({ handover, onClose, onDone }: ActProps) {
  const form = useZodForm(cashContract.disputeHandover.body, {
    defaultValues: { note: "" },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Dispute ${formatCurrency(handover.declaredAmount)} from ${handover.fromName}`}
      description={`Nothing moves. ${handover.fromName} counts again and submits a new handover.`}
      submitLabel="Dispute"
      pendingLabel="Saving…"
      tone="danger"
      onSubmit={async (body) => {
        const result = await apiWrite(cashContract.disputeHandover, {
          params: { handoverId: handover.id },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["note"],
            fallback: "Not saved.",
          });
        }
        toast({ title: `Handover from ${handover.fromName} disputed` });
        onDone();
      }}
    >
      <FormField
        name="note"
        label="What is wrong"
        hint="Say what you counted — “one ₹200 note short”."
      >
        <Textarea rows={3} maxLength={500} />
      </FormField>
    </DialogForm>
  );
}

/** The office hop's own fields; the denomination counts keep their own state. */
const handToOfficeSchema = cashContract.handOver.body.pick({
  toUserId: true,
  note: true,
});

/** The API's words for a missing note (`NOTE_REQUIRED`), shown before sending. */
const NOTE_REQUIRED =
  "required when the count differs from the recorded amount";

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
  // DenominationCount is shared with the Junior's route, so the counts stay
  // plain state; the receiver and the note are the form's.
  const [counts, setCounts] = useState(emptyCounts);
  const form = useZodForm(handToOfficeSchema, {
    defaultValues: { toUserId: receivers[0]?.userId ?? "", note: "" },
  });
  const declared = countedTotal(counts);
  const diff = subtractMoney(declared, item.toHandOver);
  const matches = isZeroMoney(diff);

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Hand ${item.lineName}'s cash for ${formatBusinessDate(item.businessDate)} to the office`}
      description={`Recorded: ${formatCurrency(item.toHandOver)}. Count what you are handing over; the Admin acknowledges it.`}
      submitLabel={`Hand over ${formatCurrency(declared)}`}
      pendingLabel="Saving…"
      onSubmit={async ({ toUserId, note }) => {
        // The API refuses a differing count without a note (NOTE_REQUIRED);
        // say so at the field before sending.
        if (!matches && !note) {
          form.setError(
            "note",
            { type: "server", message: NOTE_REQUIRED },
            { shouldFocus: true },
          );
          return;
        }
        const result = await apiWrite(cashContract.handOver, {
          body: {
            lineId: item.lineId,
            businessDate: item.businessDate,
            toUserId,
            counts: countsBody(counts),
            ...(note ? { note } : {}),
          },
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["toUserId", "note"],
            fallback: "Not saved.",
          });
        }
        toast({
          title: `Handed over ${formatCurrency(declared)} to the office`,
        });
        onDone();
      }}
    >
      <FormField name="toUserId" label="Admin receiving">
        <Select>
          {receivers.map((receiver) => (
            <option key={receiver.userId} value={receiver.userId}>
              {receiver.name}
            </option>
          ))}
        </Select>
      </FormField>
      {/* Enter while typing a count must not hand the cash over — the counts
          were never part of a form, and the total is still being read. */}
      <div
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement)
            event.preventDefault();
        }}
      >
        <DenominationCount
          counts={counts}
          onChange={setCounts}
          disabled={form.formState.isSubmitting}
        />
      </div>
      <p className="flex justify-between text-body" data-numeric>
        <span className="font-semibold text-ink">
          Counted {formatCurrency(declared)}
        </span>
        <Discrepancy amount={diff} />
      </p>
      {!matches ? (
        <FormField
          name="note"
          label="Why the count differs"
          hint="Required when the count differs from what was recorded."
        >
          <Textarea rows={2} maxLength={500} />
        </FormField>
      ) : null}
    </DialogForm>
  );
}
