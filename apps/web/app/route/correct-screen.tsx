"use client";

import { CloudSlash } from "@phosphor-icons/react/dist/ssr";
import { type CollectionListItem, collectionContract } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Button,
  Field,
  FormMessage,
  formatCurrency,
  Input,
  Textarea,
} from "@repo/ui";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { apiWrite } from "../../lib/api-write";
import { BackToRoute } from "./sync-marks";

/**
 * US-044 on the Junior's phone — ask for a collection to be corrected. A
 * collection is never edited (BR-14): this requests an ADJUSTMENT, and
 * someone other than the requester decides it.
 *
 * **Needs signal**, unlike recording one: the request goes to a Senior who
 * acts on it, and a correction queued on a phone would be an approval nobody
 * knows is waiting. Recording money at the door is the thing that must work
 * offline; asking to change a figure afterwards is not.
 */
export function CorrectScreen({ connected }: { connected: boolean }) {
  const [entries, setEntries] = useState<CollectionListItem[] | null>(null);
  const [chosen, setChosen] = useState<CollectionListItem | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = toBusinessDate(new Date());
    try {
      const result = await api(collectionContract.listCollections, {
        query: { from: today, to: today, entryType: "ORIGINAL", limit: 50 },
      });
      if (result.ok) {
        setEntries(result.body.data);
        setProblem(null);
      } else {
        setProblem("Could not load today's collections. Try again.");
      }
    } catch {
      setProblem("No signal. Connect to ask for a correction.");
    }
  }, []);

  useEffect(() => {
    // Reading today’s collections is the external read this effect
    // synchronises with; deferring a tick keeps it out of the render pass.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, connected]);

  if (!connected && entries === null) {
    return (
      <section className="flex flex-col gap-4">
        <BackToRoute />
        <FormMessage tone="warning">
          <span className="flex items-center gap-2">
            <CloudSlash aria-hidden size={18} />
            No signal. A correction needs to reach your Senior, so it cannot
            wait on the phone — your collections still save without signal.
          </span>
        </FormMessage>
      </section>
    );
  }

  if (sent) {
    return (
      <section className="flex flex-col gap-4">
        <BackToRoute />
        <FormMessage tone="info">{sent}</FormMessage>
      </section>
    );
  }

  if (chosen) {
    return (
      <RequestForm
        entry={chosen}
        onCancel={() => setChosen(null)}
        onSent={(message) => {
          setChosen(null);
          setSent(message);
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <BackToRoute />
      <h1 className="text-lg font-semibold text-ink">Ask for a correction</h1>
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      {entries !== null && entries.length === 0 ? (
        <p className="text-sm text-ink-muted">
          You have recorded nothing today. Only today&rsquo;s collections can be
          corrected from the phone; ask your Senior about an older one.
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border rounded-surface border border-border bg-surface-raised">
        {(entries ?? []).map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => setChosen(entry)}
              className="flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-ink">
                  {entry.customerName}
                </span>
                <span className="text-xs text-ink-muted">
                  {entry.accountCode}
                </span>
              </span>
              <span
                className="shrink-0 text-lg font-semibold text-ink"
                data-numeric
              >
                {formatCurrency(entry.amount)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequestForm({
  entry,
  onCancel,
  onSent,
}: {
  entry: CollectionListItem;
  onCancel: () => void;
  onSent: (message: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send() {
    setPending(true);
    setProblem(null);
    try {
      const result = await apiWrite(collectionContract.requestCorrection, {
        params: { collectionId: entry.id },
        body: { correctedAmount: amount, reason },
      });
      if (!result.ok) {
        setPending(false);
        return setProblem(result.form ?? "The request was not sent.");
      }
      onSent(
        `Sent to your Senior: ${entry.customerName}, ${formatCurrency(entry.amount)} to ${formatCurrency(amount)}. Nothing changes until they approve it.`,
      );
    } catch {
      setPending(false);
      setProblem("No signal. Try again where you have it.");
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <BackToRoute />
      <h1 className="text-lg font-semibold text-ink">
        {entry.customerName} · {formatCurrency(entry.amount)}
      </h1>
      <p className="text-sm text-ink-muted">
        The collection stays as it is. Your Senior approves the difference, and
        only then does the account change (BR-14).
      </p>
      <Field label="What you actually collected">
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label="Why" hint="Required. Your Senior sees it.">
        <Textarea
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <div className="flex gap-3">
        <Button tone="ghost" onClick={onCancel} disabled={pending}>
          Back
        </Button>
        <Button
          tone="primary"
          className="flex-1"
          onClick={() => void send()}
          disabled={pending || amount === "" || reason.trim() === ""}
        >
          {pending ? "Sending…" : "Ask to correct"}
        </Button>
      </div>
    </section>
  );
}
