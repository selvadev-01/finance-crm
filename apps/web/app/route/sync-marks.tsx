import {
  CheckCircle,
  CircleNotch,
  Clock,
  DeviceMobile,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { RouteView } from "@repo/contracts";
import { BUSINESS_TIME_ZONE } from "@repo/domain";
import { Badge } from "@repo/ui";

import type { OutboxEntry } from "../../lib/offline/db";
import type { RowState } from "../../lib/offline/outbox";

export type Classification = NonNullable<
  RouteView["customers"][number]["accounts"][number]["collectedToday"]
>["classification"];

/** BR-08 in the Junior's words, each with its status tone. */
export const CLASSIFICATION = {
  CORRECT: { label: "As expected", tone: "positive" },
  LOW: { label: "Less than expected", tone: "warning" },
  EXTRA: { label: "More than expected", tone: "info" },
  NO_PAYMENT: { label: "No payment", tone: "critical" },
} as const satisfies Record<
  Classification,
  { label: string; tone: "positive" | "warning" | "info" | "critical" }
>;

export function ClassificationMark({
  classification,
}: {
  classification: Classification;
}) {
  const { label, tone } = CLASSIFICATION[classification];
  return (
    <Badge tone={tone} shape="pill">
      {label}
    </Badge>
  );
}

/** "Lakshmi Ammal" → "LA", for the avatar on a customer card. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? [words[0]![0], words.at(-1)![0]]
      : [...(words[0] ?? "?")].slice(0, 2);
  return letters.join("").toUpperCase();
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
        <Badge tone="warning" shape="pill" mark="none">
          <DeviceMobile aria-hidden size={12} weight="bold" />
          Saved on phone
        </Badge>
      );
    case "SYNCING":
      return (
        <Badge tone="info" shape="pill" mark="none">
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
        <Badge tone="positive" shape="pill" mark="none">
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
        <Badge tone="warning" shape="pill" mark="none">
          <Clock aria-hidden size={12} weight="bold" className="text-warning" />
          Waiting for sign-in
        </Badge>
      );
    case "FAILED":
      return (
        <Badge tone="critical" shape="pill" mark="none">
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
