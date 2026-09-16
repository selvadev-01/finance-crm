"use client";

import { cashContract, organisationContract as org } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  buttonClass,
  DataTableSkeleton,
  formatBusinessDate,
  formatCurrency,
  Input,
  PageHeader,
  Select,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useSignedIn } from "../../../lib/use-me";
import { LIST_LIMIT, LoadFailed } from "../_organisation/list-controls";
import { HandoverList, HandToOfficeDialog } from "./handover-parts";

/**
 * Cash — the console's way into M08: handovers waiting for the signed-in
 * Senior or Admin to acknowledge (US-062), a Senior's cash still to take to
 * the office (US-064), and a line's day close (S-05).
 */
export function CashOverview() {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const today = toBusinessDate(new Date());
  const [lineId, setLineId] = useState(me.role === "SENIOR" ? (me.currentLineId ?? "") : "");
  const [date, setDate] = useState<string>(today);
  const [office, setOffice] = useState<string | null>(null);

  const waiting = useApiQuery(cashContract.listHandovers, { query: { status: "PENDING" } });
  const position = useApiQuery(cashContract.getCashPosition, me.role === "SENIOR" ? {} : null);
  const lines = useApiQuery(org.listLines, manages ? { query: { limit: LIST_LIMIT } } : null);
  const officeItem = position.status === "ready" ? position.data.items.find((item) => `${item.lineId}:${item.businessDate}` === office) : undefined;

  return (
    <>
      <PageHeader title="Cash" description="Handovers to acknowledge, cash to take to the office, and each line's day close." />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">Waiting for you</h2>
        {waiting.status === "loading" ? <DataTableSkeleton columns={3} rows={2} /> : null}
        {waiting.status === "error" ? <LoadFailed message={waiting.message} onRetry={waiting.reload} /> : null}
        {waiting.status === "ready" ? (
          waiting.data.data.length === 0 ? (
            <p className="text-sm text-ink-muted">No cash is waiting for you to acknowledge.</p>
          ) : (
            <HandoverList
              handovers={waiting.data.data}
              onChanged={() => {
                waiting.reload();
                position.reload();
              }}
            />
          )
        ) : null}
      </section>

      {me.role === "SENIOR" && position.status === "ready" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-ink">To take to the office</h2>
          {position.data.items.length === 0 ? (
            <p className="text-sm text-ink-muted">You are not holding any acknowledged cash.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {position.data.items.map((item) => (
                <li
                  key={`${item.lineId}:${item.businessDate}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-surface)] border border-border bg-surface-raised px-4 py-3"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-ink">{item.lineName} · {formatBusinessDate(item.businessDate)}</span>
                    <span className="text-sm text-ink-muted" data-numeric>{formatCurrency(item.toHandOver)} to hand over</span>
                  </span>
                  {item.pending ? (
                    <span className="text-sm text-ink-muted">Waiting for {item.pending.toName} to acknowledge</span>
                  ) : (
                    <button type="button" className={buttonClass("primary")} onClick={() => setOffice(`${item.lineId}:${item.businessDate}`)}>
                      Hand over to office
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">Day close</h2>
        <div className="flex flex-wrap items-end gap-3">
          {manages ? (
            <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-56">
              Line
              <Select value={lineId} onChange={(event) => setLineId(event.target.value)}>
                <option value="">Choose a line</option>
                {lines.status === "ready"
                  ? lines.data.data.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.name}
                      </option>
                    ))
                  : null}
              </Select>
            </label>
          ) : null}
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-ink sm:w-44">
            Date
            <Input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} />
          </label>
          {lineId && date ? (
            <Link href={`/lines/${lineId}/day-closes/${date}`} className={buttonClass("secondary")}>
              Open day close
            </Link>
          ) : null}
        </div>
        {me.role === "SENIOR" && !me.currentLineId ? (
          <p className="text-sm text-ink-muted">You are not assigned to a line today.</p>
        ) : null}
      </section>

      {officeItem && position.status === "ready" ? (
        <HandToOfficeDialog
          item={officeItem}
          receivers={position.data.officeReceivers}
          onClose={() => setOffice(null)}
          onDone={() => {
            setOffice(null);
            position.reload();
          }}
        />
      ) : null}
    </>
  );
}
