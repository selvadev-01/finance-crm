import {
  CheckCircle,
  CircleNotch,
  Clock,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { BUSINESS_TIME_ZONE } from "@repo/domain";
import { Badge } from "@repo/ui";

import type { OutboxEntry } from "../../lib/offline/db";
import type { RowState } from "../../lib/offline/outbox";

/**
 * Warning and info text on their own subtle backgrounds measure 2.89:1 and
 * 4.18:1 — under WCAG AA for 11px text, and these are the states a Junior
 * reads in sunlight. The word goes in ink; the dot or icon carries the colour.
 */
const LEGIBLE = "text-ink";

/**
 * The three sync states a Junior must tell apart at a glance, in sunlight
 * (offline-sync.md#status-visibility): amber "saved on phone", a spinner for
 * "syncing", a green tick for "sent to office". Each carries its word as well
 * as its colour and shape, so none depends on colour alone.
 */
export function RowStateMark({ state }: { state: RowState }) {
  switch (state) {
    case "PENDING":
      return null;
    case "SAVED":
      return (
        <Badge tone="warning" className={LEGIBLE}>
          <span aria-hidden className="size-2 rounded-full bg-warning" />
          Saved on phone
        </Badge>
      );
    case "SYNCING":
      return (
        <Badge tone="info" className={LEGIBLE}>
          <CircleNotch aria-hidden size={12} weight="bold" className="animate-spin text-info" />
          Syncing
        </Badge>
      );
    case "SYNCED":
      return (
        <Badge tone="positive">
          <CheckCircle aria-hidden size={12} weight="fill" />
          Sent to office
        </Badge>
      );
  }
}

/** S-03's per-entry state, including the two that need the Junior. */
export function EntryStateMark({ entry }: { entry: OutboxEntry }) {
  switch (entry.status) {
    case "QUEUED":
      return <RowStateMark state="SAVED" />;
    case "SYNCING":
      return <RowStateMark state="SYNCING" />;
    case "SYNCED":
      return <RowStateMark state="SYNCED" />;
    case "PAUSED_AUTH":
      return (
        <Badge tone="warning" className={LEGIBLE}>
          <Clock aria-hidden size={12} weight="bold" className="text-warning" />
          Waiting for sign-in
        </Badge>
      );
    case "FAILED":
      return (
        <Badge tone="critical">
          <WarningCircle aria-hidden size={12} weight="bold" />
          Not accepted
        </Badge>
      );
  }
}

const CLOCK = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

/**
 * A moment as the clock time the Junior saw, `10:42 am`. For when something
 * happened on the phone — never for a business date, which has no time.
 */
export function formatClockTime(instant: string | number): string {
  return CLOCK.format(new Date(instant));
}
