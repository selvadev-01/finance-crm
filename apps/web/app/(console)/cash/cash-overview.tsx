"use client";

import { cashContract } from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Button,
  buttonClass,
  Card,
  FilterBar,
  FilterField,
  formatBusinessDate,
  Input,
  ListSkeleton,
  PageHeader,
  Section,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";

import { LineFilter } from "../../../components/line-filter";
import { Money } from "../../../components/money";
import { LoadFailed } from "../../../components/query-state";
import { canManageOrganisation } from "../../../lib/roles";
import { useApiQuery } from "../../../lib/use-api-query";
import { useListState } from "../../../lib/use-list-state";
import { useSignedIn } from "../../../lib/use-me";
import { HandoverList, HandToOfficeDialog } from "./handover-parts";

/**
 * The day close picker's state. `""` is the default: the Senior's own line
 * (an Admin chooses one), and today.
 */
export const CASH_FILTERS = { line: "", date: "" };

/**
 * Cash — the console's way into M08: handovers waiting for the signed-in
 * Senior or Admin to acknowledge (US-062), a Senior's cash still to take to
 * the office (US-064), and a line's day close (S-05).
 */
export function CashOverview({
  initial,
}: {
  initial: Partial<typeof CASH_FILTERS>;
}) {
  const me = useSignedIn();
  const manages = canManageOrganisation(me.role);
  const today = toBusinessDate(new Date());
  const { filters, setFilter } = useListState(CASH_FILTERS, initial);
  const lineId = manages
    ? filters.line
    : me.role === "SENIOR"
      ? (me.currentLineId ?? "")
      : "";
  const date = filters.date || today;
  const [office, setOffice] = useState<string | null>(null);

  const waiting = useApiQuery(cashContract.listHandovers, {
    query: { status: "PENDING" },
  });
  const position = useApiQuery(
    cashContract.getCashPosition,
    me.role === "SENIOR" ? {} : null,
  );
  const officeItem =
    position.status === "ready"
      ? position.data.items.find(
          (item) => `${item.lineId}:${item.businessDate}` === office,
        )
      : undefined;

  return (
    <>
      <PageHeader
        title="Cash"
        description="Handovers to acknowledge, cash to take to the office, and each line's day close."
      />

      <Section title="Waiting for you">
        {waiting.status === "loading" ? (
          <ListSkeleton columns={3} rows={2} />
        ) : null}
        {waiting.status === "error" ? (
          <LoadFailed message={waiting.message} onRetry={waiting.reload} />
        ) : null}
        {waiting.status === "ready" ? (
          waiting.data.data.length === 0 ? (
            <p className="text-body text-ink-muted">
              No cash is waiting for you to acknowledge.
            </p>
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
      </Section>

      {me.role === "SENIOR" && position.status === "ready" ? (
        <Section title="To take to the office">
          {position.data.items.length === 0 ? (
            <p className="text-body text-ink-muted">
              You are not holding any acknowledged cash.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {position.data.items.map((item) => {
                const key = `${item.lineId}:${item.businessDate}`;
                return (
                  <li key={key}>
                    <Card.Root>
                      <Card.Body className="flex-row flex-wrap items-center justify-between gap-3 py-3">
                        <span className="flex flex-col">
                          <span className="font-medium text-ink">
                            {item.lineName} ·{" "}
                            {formatBusinessDate(item.businessDate)}
                          </span>
                          <span className="text-caption text-ink-muted">
                            <Money amount={item.toHandOver} /> to hand over
                          </span>
                        </span>
                        {item.pending ? (
                          <span className="text-caption text-ink-muted">
                            Waiting for {item.pending.toName} to acknowledge
                          </span>
                        ) : (
                          <Button tone="primary" onClick={() => setOffice(key)}>
                            Hand over to office
                          </Button>
                        )}
                      </Card.Body>
                    </Card.Root>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="Day close">
        <FilterBar
          summary={[
            manages ? (lineId ? "One line" : "Choose a line") : null,
            date ? formatBusinessDate(date) : "Choose a date",
          ]
            .filter(Boolean)
            .join(", ")}
          actions={
            lineId && date ? (
              <Link
                href={`/lines/${lineId}/day-closes/${date}`}
                className={buttonClass("secondary")}
              >
                Open day close
              </Link>
            ) : null
          }
        >
          {manages ? (
            <LineFilter
              value={lineId}
              onChange={(value) => setFilter("line", value)}
            />
          ) : null}
          <FilterField label="Date" width="sm">
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(event) => setFilter("date", event.target.value)}
            />
          </FilterField>
        </FilterBar>
        {me.role === "SENIOR" && !me.currentLineId ? (
          <p className="text-body text-ink-muted">
            You are not assigned to a line today.
          </p>
        ) : null}
      </Section>

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
