import {
  ArrowLeft,
  CheckCircle,
  CircleNotch,
  Clock,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { BUSINESS_TIME_ZONE } from "@repo/domain";
import { Badge, Button } from "@repo/ui";

import type { OutboxEntry } from "../../lib/offline/db";
import type { RowState } from "../../lib/offline/outbox";
import { backToRoute } from "./hash-view";

/**
 * The way back to S-01 from every other view. Its accessible name is exactly
 * "Route" — the offline E2E suite finds it by that name.
 */
export function BackToRoute() {
  return (
    <div>
      <Button
        tone="ghost"
        onClick={backToRoute}
        className="-ml-3 font-semibold text-accent hover:text-accent-hover"
      >
        <ArrowLeft aria-hidden size={20} weight="regular" />
        Route
      </Button>
    </div>
  );
}

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
        <Badge tone="warning" mark="none">
          <span aria-hidden className="size-2 rounded-full bg-warning-bright" />
          Saved on phone
        </Badge>
      );
    case "SYNCING":
      return (
        <Badge tone="info" mark="none">
          <CircleNotch
            aria-hidden
            size={12}
            weight="bold"
            className="animate-spin text-info"
          />
          Syncing
        </Badge>
      );
    case "SYNCED":
      return (
        <Badge tone="positive" mark="none">
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
        <Badge tone="warning" mark="none">
          <Clock aria-hidden size={12} weight="bold" className="text-warning" />
          Waiting for sign-in
        </Badge>
      );
    case "FAILED":
      return (
        <Badge tone="critical" mark="none">
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
