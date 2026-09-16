"use client";

import { cashContract, type DayCloseView } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  DataTable,
  DataTableSkeleton,
  Dialog,
  DialogActions,
  Field,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Input,
  PageHeader,
  Textarea,
} from "@repo/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { apiWrite } from "../../../../../../lib/api-write";
import { difference } from "../../../../../../lib/denomination-count";
import { useApiQuery } from "../../../../../../lib/use-api-query";
import { useSignedIn } from "../../../../../../lib/use-me";
import { LoadFailed, RecordNotFound } from "../../../../_organisation/list-controls";
import { ClassificationBadge } from "../../../../collections/collection-parts";
import { DiscrepancyText, HandoverList, HandToOfficeDialog } from "../../../../cash/handover-parts";

const STATUS = {
  OPEN: { label: "Open", tone: "neutral" },
  CLOSED: { label: "Closed", tone: "warning" },
  REOPENED: { label: "Reopened", tone: "warning" },
  TALLIED: { label: "Tallied", tone: "positive" },
} as const;

const SYNC = {
  SENT: { label: "All sent", tone: "positive" },
  UNSENT: { label: "Not sent", tone: "warning" },
  NOT_HEARD: { label: "Not heard from", tone: "neutral" },
} as const;

/**
 * S-05 · Day close. The line's day as it stands: expected against collected,
 * each Junior's collections and whether their phone has sent everything,
 * every entry that needs a look, and the cash handovers. Close, reopen
 * (Admin), and hand the day's cash to the office (Senior).
 */
export function DayCloseScreen({ lineId, businessDate }: { lineId: string; businessDate: string }) {
  const me = useSignedIn();
  const router = useRouter();
  const [dialog, setDialog] = useState<"close" | "reopen" | "office" | null>(null);
  const day = useApiQuery(cashContract.getDayClose, { params: { lineId, businessDate } });
  const position = useApiQuery(cashContract.getCashPosition, me.role === "SENIOR" ? {} : null);

  if (day.status === "loading") return <DataTableSkeleton columns={4} rows={4} />;
  if (day.status === "not-found" || day.status === "not-permitted") return <RecordNotFound noun="Line" />;
  if (day.status === "error") return <LoadFailed message={day.message} onRetry={day.reload} />;

  const view = day.data;
  const officeItem =
    position.status === "ready"
      ? position.data.items.find(
          (item) => item.lineId === lineId && item.businessDate === businessDate && item.hop === "SENIOR_TO_OFFICE" && !item.pending,
        )
      : undefined;
  const gap = difference(view.expectedTotal, view.collectedTotal);
  const reload = () => {
    day.reload();
    position.reload();
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/lines/${lineId}`} className="hover:text-ink hover:underline">{view.lineName}</Link>}
        title={`Day close · ${formatBusinessDate(businessDate)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[view.status].tone}>{STATUS[view.status].label}</Badge>
            {view.closedAt && view.closedByName ? <span>closed by {view.closedByName}</span> : null}
            {view.status === "REOPENED" ? (
              <span>{view.reopenReason ? `reopened: ${view.reopenReason}` : "reopened automatically by a late collection — close it again"}</span>
            ) : null}
          </span>
        }
        actions={
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Date
              <Input
                type="date"
                value={businessDate}
                max={toBusinessDate(new Date())}
                onChange={(event) => {
                  if (event.target.value) router.push(`/lines/${lineId}/day-closes/${event.target.value}`);
                }}
              />
            </label>
            {officeItem ? (
              <Button tone="secondary" onClick={() => setDialog("office")}>Hand over to office</Button>
            ) : null}
            {view.canReopen ? <Button tone="secondary" onClick={() => setDialog("reopen")}>Reopen</Button> : null}
            {view.canClose ? <Button tone="primary" onClick={() => setDialog("close")}>Close day</Button> : null}
          </span>
        }
      />

      {view.day.kind !== "WORKING" ? (
        <FormMessage tone="info">
          {view.day.kind === "SUNDAY" ? "Sunday: no collections are due." : `Holiday: ${view.day.name}. No collections are due.`}
        </FormMessage>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Expected">{formatCurrency(view.expectedTotal)}</Figure>
        <Figure label="Collected">{formatCurrency(view.collectedTotal)}</Figure>
        <Figure label={gap.startsWith("-") ? "Surplus" : "Shortfall"}>
          {formatCurrency(gap.replace("-", ""))}
        </Figure>
        <Figure label="Cash received">
          {formatCurrency(view.cashReceivedTotal)}
          <span className="block text-sm font-normal">
            {view.handovers.some((handover) => handover.hop === "JUNIOR_TO_SENIOR" && handover.status === "ACKNOWLEDGED") ? (
              <DiscrepancyText amount={view.discrepancy} />
            ) : (
              // Nothing handed over yet is not a shortage.
              <span className="text-ink-muted">not handed over yet</span>
            )}
          </span>
        </Figure>
      </dl>

      <Section title="Juniors">
        {view.juniors.length === 0 ? (
          <p className="text-sm text-ink-muted">No Junior worked this line on this day.</p>
        ) : (
          <DataTable
            caption="Juniors"
            rows={view.juniors}
            rowKey={(junior) => junior.userId}
            columns={[
              { header: "Junior", cell: (junior) => junior.name },
              { header: "Entries", align: "end", cell: (junior) => <span data-numeric>{junior.entries}</span> },
              { header: "Collected", align: "end", cell: (junior) => <span data-numeric>{formatCurrency(junior.collectedAmount)}</span> },
              {
                header: "Phone",
                align: "end",
                cell: (junior) => (
                  <Badge tone={SYNC[junior.sync].tone}>
                    {SYNC[junior.sync].label}
                    {junior.sync === "UNSENT" && junior.unsentCount ? ` · ${junior.unsentCount}` : ""}
                  </Badge>
                ),
              },
            ]}
          />
        )}
      </Section>

      <Section title="Needs a look">
        {view.exceptions.length === 0 ? (
          <p className="text-sm text-ink-muted">Every collection matched what was expected.</p>
        ) : (
          <DataTable
            caption="Entries that need a look"
            rows={view.exceptions}
            rowKey={(entry) => `${entry.kind}-${entry.accountLoanId}-${entry.collectionId ?? ""}`}
            columns={[
              {
                header: "Customer",
                cell: (entry) =>
                  entry.collectionId ? (
                    <Link href={`/collections/${entry.collectionId}`} className="flex flex-col font-medium text-ink hover:text-accent hover:underline">
                      {entry.customerName}
                      <span className="font-mono text-2xs font-normal text-ink-muted">{entry.accountCode}</span>
                    </Link>
                  ) : (
                    <span className="flex flex-col font-medium text-ink">
                      {entry.customerName}
                      <span className="font-mono text-2xs font-normal text-ink-muted">{entry.accountCode}</span>
                    </span>
                  ),
              },
              { header: "Expected", align: "end", cell: (entry) => <span data-numeric>{formatCurrency(entry.expectedAmount)}</span> },
              {
                header: "Paid",
                align: "end",
                cell: (entry) => <span data-numeric>{entry.amount === null ? "—" : formatCurrency(entry.amount)}</span>,
              },
              {
                header: "",
                align: "end",
                cell: (entry) =>
                  entry.kind === "MISSED" ? (
                    <Badge tone="critical">Missed</Badge>
                  ) : entry.kind === "NOT_VISITED" ? (
                    <Badge tone="neutral">Not visited yet</Badge>
                  ) : (
                    <ClassificationBadge classification={entry.kind} />
                  ),
              },
            ]}
          />
        )}
      </Section>

      <Section title="Cash handovers">
        <HandoverList handovers={view.handovers} onChanged={reload} />
      </Section>

      {dialog === "close" ? (
        <CloseDialog view={view} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      ) : null}
      {dialog === "reopen" ? (
        <ReopenDialog view={view} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      ) : null}
      {dialog === "office" && officeItem && position.status === "ready" ? (
        <HandToOfficeDialog
          item={officeItem}
          receivers={position.data.officeReceivers}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); reload(); }}
        />
      ) : null}
    </>
  );
}

/**
 * Closing names what it does: the figures it locks in, the slots it marks
 * missed, and — when a phone has not sent everything — who, before closing
 * anyway (US-060).
 */
function CloseDialog({ view, onClose, onDone }: { view: DayCloseView; onClose: () => void; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [unsynced, setUnsynced] = useState<string | null>(null);
  const waiting = view.juniors.filter((junior) => junior.sync !== "SENT");
  const notVisited = view.exceptions.filter((entry) => entry.kind === "NOT_VISITED").length;

  async function close(confirmUnsynced: boolean) {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(cashContract.closeDay, {
      params: { lineId: view.lineId, businessDate: view.businessDate },
      body: confirmUnsynced ? { confirmUnsynced: true } : {},
    });
    setPending(false);
    if (result.ok) return onDone();
    if (result.code === "UNSYNCED_DEVICES") return setUnsynced(result.form);
    setProblem(result.form ?? "The day was not closed.");
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={`Close ${view.lineName} for ${formatBusinessDate(view.businessDate)}`}
      description={`Collected ${formatCurrency(view.collectedTotal)} against ${formatCurrency(view.expectedTotal)} expected.${notVisited ? ` ${notVisited} unvisited ${notVisited === 1 ? "slot is" : "slots are"} marked missed.` : ""} A collection that arrives later reopens the day.`}
    >
      {waiting.length > 0 && !unsynced ? (
        <FormMessage tone="info">
          {waiting.map((junior) => junior.name).join(", ")} {waiting.length === 1 ? "has" : "have"} not confirmed everything is sent.
        </FormMessage>
      ) : null}
      {unsynced ? <FormMessage tone="critical">{unsynced}</FormMessage> : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {unsynced ? (
          <Button tone="primary" onClick={() => void close(true)} disabled={pending}>
            Close anyway
          </Button>
        ) : (
          <Button tone="primary" onClick={() => void close(false)} disabled={pending}>
            {pending ? "Closing…" : "Close day"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function ReopenDialog({ view, onClose, onDone }: { view: DayCloseView; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function reopen() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(cashContract.reopenDay, {
      params: { lineId: view.lineId, businessDate: view.businessDate },
      body: { reason },
    });
    setPending(false);
    if (!result.ok) return setProblem(result.fields["reason"] ?? result.form ?? "The day was not reopened.");
    onDone();
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={`Reopen ${view.lineName} for ${formatBusinessDate(view.businessDate)}`}
      description="The day's figures become open to change until it is closed again. The reason is kept in the audit log."
    >
      <Field label="Reason">
        <Textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button tone="danger" onClick={() => void reopen()} disabled={pending}>
          {pending ? "Reopening…" : "Reopen day"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3">
      <dt className="text-2xs font-medium tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="text-base font-semibold text-ink" data-numeric>
        {children}
      </dd>
    </div>
  );
}

