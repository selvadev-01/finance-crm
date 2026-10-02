"use client";

import { BellRinging } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, DialogActions, FormMessage, toast } from "@repo/ui";
import { useEffect, useState } from "react";

import { CONSOLE_PUSH_WORKER, enablePush, shouldOfferPush } from "./push";

/**
 * Set once this device has been asked, whatever the answer — "Not now"
 * included. The prompt is for a new device; the same device is never asked
 * twice. Kept in this browser's storage, so a new device (or a cleared
 * browser) is asked again, and nothing else is.
 */
const ASKED = "rasi.push-prompt.asked";

function askedOnThisDevice(): boolean {
  try {
    return localStorage.getItem(ASKED) === "1";
  } catch {
    // Storage blocked: never nag on every visit — treat it as already asked.
    return true;
  }
}

function rememberAsked(): void {
  try {
    localStorage.setItem(ASKED, "1");
  } catch {
    // Storage blocked: `askedOnThisDevice` already answers "asked".
  }
}

/**
 * Offers push on a device that has never been asked, as the dashboard opens
 * after signing in. Browsers only let a page ask for notification permission
 * from a tap, so this is a confirm dialog whose button does the asking — not
 * the browser's prompt fired on load.
 *
 * Shown only when push is set up on the server, this browser supports it and
 * has not blocked notifications, it is not registered for pushes, and this
 * device has never been asked. Once asked — whatever the answer, "Not now" included —
 * it is not asked again; the switch on Settings → Notifications stays the way
 * to change it.
 */
export function PushPrompt() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (askedOnThisDevice()) return;
    shouldOfferPush(CONSOLE_PUSH_WORKER)
      .then((offer) => {
        // Only an actual prompt counts as asking: a device not offered one —
        // push off on the server, already registered, or blocked — is not
        // marked, so it is still asked once push is there to offer.
        if (cancelled || !offer) return;
        rememberAsked();
        setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const later = () => {
    if (busy) return;
    rememberAsked();
    setOpen(false);
  };

  async function turnOn() {
    setBusy(true);
    setProblem(null);
    const state = await enablePush(CONSOLE_PUSH_WORKER, "Console browser").catch(
      () => "off" as const,
    );
    setBusy(false);
    if (state === "on") {
      setOpen(false);
      toast({
        title: "Notifications are on for this device",
        description: "Alerts and warnings reach you here even when Rasi is closed.",
      });
    } else if (state === "blocked") {
      rememberAsked();
      setOpen(false);
      toast({
        tone: "info",
        title: "Notifications are blocked in this browser",
        description:
          "Allow them in the browser's site settings, then turn them on from Settings → Notifications.",
      });
    } else {
      setProblem("They could not be turned on. Try again, or later from Settings → Notifications.");
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open
      onClose={later}
      title="Turn on notifications on this device?"
      description="Get alerts and warnings here — low and missed collections, cash differences, things waiting for your approval — even when Rasi is closed. Your browser may ask you to allow them."
    >
      <div className="flex items-center gap-3 text-ink-muted">
        <BellRinging aria-hidden size={28} />
        <p className="text-caption">
          Everything still appears under the bell in the app. You can change this
          any time in Settings → Notifications.
        </p>
      </div>
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={later} disabled={busy}>
          Not now
        </Button>
        <Button tone="primary" onClick={() => void turnOn()} disabled={busy}>
          {busy ? "Turning on…" : "Turn on notifications"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
