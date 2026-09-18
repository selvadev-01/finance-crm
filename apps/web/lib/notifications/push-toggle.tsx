"use client";

import { Button } from "@repo/ui";
import { useEffect, useState } from "react";

import { enablePush, type PushState, pushState } from "./push";

const EXPLAIN: Record<PushState, string> = {
  unsupported:
    "This browser cannot receive push notifications. Alerts still appear here.",
  "not-offered":
    "Push notifications are not switched on for Rasi yet. Alerts still appear here.",
  blocked:
    "Notifications are blocked for Rasi in this browser's settings. Allow them there to get alerts on this device.",
  off: "Get alerts and warnings on this device even when Rasi is closed.",
  on: "This device receives alerts and warnings.",
};

/**
 * "Notify me on this device" (US-071). Permission is only ever asked from this
 * tap, never on page load; whatever the answer, the centre still shows every
 * notification.
 */
export function PushToggle({
  worker,
  deviceLabel,
}: {
  worker: { url: string; scope: string };
  deviceLabel: string;
}) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pushState(worker)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState("not-offered");
      });
    return () => {
      cancelled = true;
    };
  }, [worker]);

  if (state === null) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-surface-raised px-4 py-3">
      <p className="text-sm text-ink-muted" role="status">
        {EXPLAIN[state]}
      </p>
      {state === "off" ? (
        <Button
          tone="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setState(
              await enablePush(worker, deviceLabel).catch(
                (): PushState => "off",
              ),
            );
            setBusy(false);
          }}
        >
          {busy ? "Turning on…" : "Notify me on this device"}
        </Button>
      ) : null}
    </div>
  );
}
