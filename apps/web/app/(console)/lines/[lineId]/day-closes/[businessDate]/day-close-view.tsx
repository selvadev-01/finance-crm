"use client";

import { cashContract, type DayCloseView } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Badge,
  Button,
  DataView,
  Dialog,
  DialogActions,
  DialogForm,
  FilterField,
  FormField,
  FormMessage,
  formatBusinessDate,
  formatCurrency,
  Input,
  PageHeader,
  Section,
  Stat,
  StatGrid,
  Textarea,
  toast,
  useZodForm,
} from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  displayColumn,
  identityColumn,
  moneyColumn,
  valueColumn,
} from "../../../../../../components/columns";
import { Discrepancy } from "../../../../../../components/money";
import { PageTrail } from "../../../../../../components/page-trail";
import { RecordFallback } from "../../../../../../components/query-state";
import { StatusBadge } from "../../../../../../components/status-badge";
import { apiWrite } from "../../../../../../lib/api-write";
import { applyWriteFailure } from "../../../../../../lib/form-errors";
import {
  absMoney,
  isNegativeMoney,
  isZeroMoney,
  subtractMoney,
} from "../../../../../../lib/money";
import { useApiQuery } from "../../../../../../lib/use-api-query";
import { useSignedIn } from "../../../../../../lib/use-me";
import {
  HandoverList,
  HandToOfficeDialog,
} from "../../../../cash/handover-parts";

type Junior = DayCloseView["juniors"][number];
type Exception = DayCloseView["exceptions"][number];

/**
 * S-05 · Day close. The line's day as it stands: expected against collected,
 * each Junior's collections and whether their phone has sent everything,
 * every entry that needs a look, and the cash handovers. Close, reopen
 * (Admin), and hand the day's cash to the office (Senior).
 */
export function DayCloseScreen({
  lineId,
  businessDate,
}: {
  lineId: string;
  businessDate: string;
}) {
  const me = useSignedIn();
  const router = useRouter();
  const [dialog, setDialog] = useState<"close" | "reopen" | "office" | null>(
    null,
  );
  const day = useApiQuery(cashContract.getDayClose, {
    params: { lineId, businessDate },
  });
  const position = useApiQuery(
    cashContract.getCashPosition,
    me.role === "SENIOR" ? {} : null,
  );

  if (day.status !== "ready") return <RecordFallback query={day} noun="Line" />;

  const view = day.data;
  const officeItem =
    position.status === "ready"
      ? position.data.items.find(
          (item) =>
            item.lineId === lineId &&
            item.businessDate === businessDate &&
            item.hop === "SENIOR_TO_OFFICE" &&
            !item.pending,
        )
      : undefined;
  // expected − collected: above zero is a shortfall, below it a surplus.
  const gap = subtractMoney(view.expectedTotal, view.collectedTotal);
  const surplus = isNegativeMoney(gap);
  const reload = () => {
    day.reload();
    position.reload();
  };
  const afterDialog = () => {
    setDialog(null);
    reload();
  };

  return (
    <>
      <PageHeader
        trail={
          <PageTrail
            steps={[
              { label: view.lineName, href: `/lines/${lineId}` },
              { label: `Day close · ${formatBusinessDate(businessDate)}` },
            ]}
          />
        }
        title={`Day close · ${formatBusinessDate(businessDate)}`}
        meta={
          <>
            <StatusBadge kind="day" value={view.status} />
            {view.closedAt && view.closedByName ? (
              <span>closed by {view.closedByName}</span>
            ) : null}
            {view.status === "REOPENED" ? (
              <span>
                {view.reopenReason
                  ? `reopened: ${view.reopenReason}`
                  : "reopened automatically by a late collection — close it again"}
              </span>
            ) : null}
          </>
        }
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <FilterField label="Date" width="sm">
              <Input
                type="date"
                value={businessDate}
                max={toBusinessDate(new Date())}
                onChange={(event) => {
                  if (event.target.value)
                    router.push(
                      `/lines/${lineId}/day-closes/${event.target.value}`,
                    );
                }}
              />
            </FilterField>
            {officeItem ? (
              <Button tone="secondary" onClick={() => setDialog("office")}>
                Hand over to office
              </Button>
            ) : null}
            {view.canReopen ? (
              <Button tone="secondary" onClick={() => setDialog("reopen")}>
                Reopen
              </Button>
            ) : null}
            {view.canClose ? (
              <Button tone="primary" onClick={() => setDialog("close")}>
                Close day
              </Button>
            ) : null}
          </div>
        }
      />

      {view.day.kind !== "WORKING" ? (
        <FormMessage tone="info">
          {view.day.kind === "SUNDAY"
            ? "Sunday: no collections are due."
            : `Holiday: ${view.day.name}. No collections are due.`}
        </FormMessage>
      ) : null}

      <StatGrid columns={4}>
        <Stat label="Expected">{formatCurrency(view.expectedTotal)}</Stat>
        <Stat label="Collected">{formatCurrency(view.collectedTotal)}</Stat>
        <Stat
          label={surplus ? "Surplus" : "Shortfall"}
          tone={surplus || isZeroMoney(gap) ? "neutral" : "warning"}
        >
          {formatCurrency(absMoney(gap))}
        </Stat>
        <Stat
          label="Cash received"
          hint={
            view.handovers.some(
              (handover) =>
                handover.hop === "JUNIOR_TO_SENIOR" &&
                handover.status === "ACKNOWLEDGED",
            ) ? (
              <Discrepancy amount={view.discrepancy} />
            ) : (
              // Nothing handed over yet is not a shortage.
              "not handed over yet"
            )
          }
        >
          {formatCurrency(view.cashReceivedTotal)}
        </Stat>
      </StatGrid>

      <Section title="Juniors">
        {view.juniors.length === 0 ? (
          <p className="text-body text-ink-muted">
            No Junior worked this line on this day.
          </p>
        ) : (
          <DataView
            caption="Juniors"
            rows={view.juniors}
            getRowId={(junior) => junior.userId}
            complete
            columns={[
              valueColumn<Junior>({
                id: "junior",
                header: "Junior",
                value: (junior) => junior.name,
              }),
              valueColumn<Junior>({
                id: "entries",
                header: "Entries",
                align: "end",
                value: (junior) => junior.entries,
                cell: (junior) => <span data-numeric>{junior.entries}</span>,
              }),
              moneyColumn<Junior>({
                id: "collected",
                header: "Collected",
                amount: (junior) => junior.collectedAmount,
                card: "headline",
              }),
              displayColumn<Junior>({
                id: "phone",
                header: "Phone",
                align: "end",
                card: "status",
                cell: (junior) => (
                  <StatusBadge
                    kind="sync"
                    value={junior.sync}
                    suffix={
                      junior.sync === "UNSENT" && junior.unsentCount
                        ? `· ${junior.unsentCount}`
                        : undefined
                    }
                  />
                ),
              }),
            ]}
          />
        )}
      </Section>

      <Section title="Needs a look">
        {view.exceptions.length === 0 ? (
          <p className="text-body text-ink-muted">
            Every collection matched what was expected.
          </p>
        ) : (
          <DataView
            caption="Entries that need a look"
            rows={view.exceptions}
            getRowId={(entry) =>
              `${entry.kind}-${entry.accountLoanId}-${entry.collectionId ?? ""}`
            }
            complete
            columns={[
              identityColumn<Exception>({
                header: "Customer",
                name: (entry) => entry.customerName,
                code: (entry) => entry.accountCode,
                href: (entry) =>
                  entry.collectionId
                    ? `/collections/${entry.collectionId}`
                    : null,
              }),
              moneyColumn<Exception>({
                id: "expected",
                header: "Expected",
                amount: (entry) => entry.expectedAmount,
              }),
              moneyColumn<Exception>({
                id: "paid",
                header: "Paid",
                // An unvisited or missed slot sorts as nothing paid.
                amount: (entry) => entry.amount ?? "0",
                render: (entry) =>
                  entry.amount === null ? (
                    <span data-numeric>—</span>
                  ) : undefined,
                card: "headline",
              }),
              displayColumn<Exception>({
                id: "kind",
                header: "",
                align: "end",
                card: "status",
                cell: (entry) =>
                  entry.kind === "MISSED" ? (
                    <StatusBadge kind="slot" value="MISSED" />
                  ) : entry.kind === "NOT_VISITED" ? (
                    <Badge tone="neutral">Not visited yet</Badge>
                  ) : (
                    <StatusBadge kind="classification" value={entry.kind} />
                  ),
              }),
            ]}
          />
        )}
      </Section>

      <Section title="Cash handovers">
        <HandoverList handovers={view.handovers} onChanged={reload} />
      </Section>

      {dialog === "close" ? (
        <CloseDialog
          view={view}
          onClose={() => setDialog(null)}
          onDone={afterDialog}
        />
      ) : null}
      {dialog === "reopen" ? (
        <ReopenDialog
          view={view}
          onClose={() => setDialog(null)}
          onDone={afterDialog}
        />
      ) : null}
      {dialog === "office" && officeItem && position.status === "ready" ? (
        <HandToOfficeDialog
          item={officeItem}
          receivers={position.data.officeReceivers}
          onClose={() => setDialog(null)}
          onDone={afterDialog}
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
function CloseDialog({
  view,
  onClose,
  onDone,
}: {
  view: DayCloseView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [unsynced, setUnsynced] = useState<string | null>(null);
  const waiting = view.juniors.filter((junior) => junior.sync !== "SENT");
  const notVisited = view.exceptions.filter(
    (entry) => entry.kind === "NOT_VISITED",
  ).length;

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
          {waiting.map((junior) => junior.name).join(", ")}{" "}
          {waiting.length === 1 ? "has" : "have"} not confirmed everything is
          sent.
        </FormMessage>
      ) : null}
      {unsynced ? <FormMessage tone="critical">{unsynced}</FormMessage> : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {unsynced ? (
          <Button
            tone="primary"
            onClick={() => void close(true)}
            disabled={pending}
          >
            Close anyway
          </Button>
        ) : (
          <Button
            tone="primary"
            onClick={() => void close(false)}
            disabled={pending}
          >
            {pending ? "Closing…" : "Close day"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function ReopenDialog({
  view,
  onClose,
  onDone,
}: {
  view: DayCloseView;
  onClose: () => void;
  onDone: () => void;
}) {
  const form = useZodForm(cashContract.reopenDay.body, {
    defaultValues: { reason: "" },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Reopen ${view.lineName} for ${formatBusinessDate(view.businessDate)}`}
      description="The day's figures become open to change until it is closed again. The reason is kept in the audit log."
      submitLabel="Reopen day"
      pendingLabel="Reopening…"
      tone="danger"
      onSubmit={async (body) => {
        const result = await apiWrite(cashContract.reopenDay, {
          params: { lineId: view.lineId, businessDate: view.businessDate },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["reason"],
            fallback: "The day was not reopened.",
          });
        }
        toast({
          title: `${view.lineName} reopened for ${formatBusinessDate(view.businessDate)}`,
        });
        onDone();
      }}
    >
      <FormField name="reason" label="Reason">
        <Textarea rows={3} maxLength={500} />
      </FormField>
    </DialogForm>
  );
}
