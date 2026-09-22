"use client";

import {
  CheckCircle,
  CloudSlash,
  Info,
  RadioButton,
  Circle,
} from "@phosphor-icons/react/dist/ssr";
import { type CollectionListItem, collectionContract } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Button,
  cn,
  Field,
  FormMessage,
  formatCurrency,
  Input,
  Skeleton,
  Textarea,
} from "@repo/ui";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { apiWrite } from "../../lib/api-write";
import { Banner, cardClass, FieldPage, Section } from "./app-chrome";

/**
 * J-06 · Ask for a correction (US-044 on the Junior's phone). A collection is
 * never edited (BR-14): this requests an ADJUSTMENT, and someone other than
 * the requester decides it.
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

  return (
    <FieldPage back title="Ask for a correction" testId="correct">
      {!connected && entries === null ? (
        <Banner tone="warning" icon={<CloudSlash size={20} weight="regular" />}>
          No signal. A correction needs to reach your Senior, so it cannot wait
          on the phone — your collections still save without signal.
        </Banner>
      ) : (
        <>
          <p className="flex items-start gap-3 rounded-surface border border-border bg-surface-sunken px-4 py-3 text-sm text-ink">
            <Info
              aria-hidden
              size={20}
              weight="regular"
              className="shrink-0 text-ink-muted"
            />
            The collection stays as it is. Your Senior approves the difference,
            and only then does the account change.
          </p>
          {sent ? (
            <p
              role="status"
              className="flex items-start gap-3 rounded-surface border border-positive-border bg-positive-subtle px-4 py-3 text-sm font-medium text-ink"
            >
              <CheckCircle
                aria-hidden
                size={20}
                weight="fill"
                className="shrink-0 text-positive"
              />
              {sent}
            </p>
          ) : null}
          {problem ? (
            <FormMessage tone="critical">{problem}</FormMessage>
          ) : null}
          {entries === null && !problem ? (
            <div
              role="status"
              aria-label="Loading today’s collections"
              className="flex flex-col gap-2"
            >
              <Skeleton className="h-16 rounded-overlay" />
              <Skeleton className="h-16 rounded-overlay" />
            </div>
          ) : null}
          {entries !== null && entries.length === 0 ? (
            <p className={cn(cardClass, "p-4 text-base text-ink-muted")}>
              You have recorded nothing today that has reached the office. Only
              today&rsquo;s collections can be corrected from the phone; ask
              your Senior about an older one.
            </p>
          ) : null}
          {entries && entries.length > 0 ? (
            <Section title="Today’s collections">
              <ul
                aria-label="Collection to correct"
                className="flex flex-col gap-2"
              >
                {entries.map((entry) => {
                  const selected = chosen?.id === entry.id;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setChosen(entry);
                          setSent(null);
                        }}
                        className={cn(
                          cardClass,
                          "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left",
                          selected && "border-accent bg-accent-subtle",
                        )}
                      >
                        {selected ? (
                          <RadioButton
                            aria-hidden
                            size={22}
                            weight="fill"
                            className="shrink-0 text-accent"
                          />
                        ) : (
                          <Circle
                            aria-hidden
                            size={22}
                            weight="regular"
                            className="shrink-0 text-ink-subtle"
                          />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-semibold text-ink">
                            {entry.customerName}
                          </span>
                          <span className="font-mono text-xs text-ink-muted">
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
                  );
                })}
              </ul>
            </Section>
          ) : null}
          {chosen ? (
            <RequestForm
              key={chosen.id}
              entry={chosen}
              onSent={(message) => {
                setChosen(null);
                setSent(message);
              }}
            />
          ) : null}
        </>
      )}
    </FieldPage>
  );
}

function RequestForm({
  entry,
  onSent,
}: {
  entry: CollectionListItem;
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
    <section className={cn(cardClass, "flex flex-col gap-3 p-4")}>
      <h2 className="text-base font-semibold text-ink" data-numeric>
        {entry.customerName} · {formatCurrency(entry.amount)}
      </h2>
      <Field label="What you actually collected (₹)">
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="h-14 text-right text-xl font-semibold"
          data-numeric
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
      <Button
        tone="primary"
        className="h-14 w-full rounded-pill text-base font-semibold"
        onClick={() => void send()}
        disabled={pending || amount === "" || reason.trim() === ""}
      >
        {pending ? "Sending…" : "Ask to correct"}
      </Button>
    </section>
  );
}
