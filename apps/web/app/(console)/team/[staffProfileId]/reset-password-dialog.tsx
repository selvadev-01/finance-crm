"use client";

import { staffContract } from "@repo/contracts";
import { Button, Dialog, DialogActions, FormMessage } from "@repo/ui";
import { useState } from "react";

import { apiWrite } from "../../../../lib/api-write";

/**
 * US-003 Admin-initiated reset, for field staff without email.
 *
 * The confirmation names the consequence: every device is signed out at once.
 * The temporary password is shown **once**, in this dialog, and is never
 * stored or shown again — closing the dialog is the end of it (M01).
 */
export function ResetPasswordDialog({
  staffProfileId,
  name,
  onClose,
}: {
  staffProfileId: string;
  name: string;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reset() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(staffContract.resetStaffPassword, {
      params: { staffProfileId },
    });
    setPending(false);
    if (!result.ok)
      return setProblem(
        result.form ?? "The password was not reset. Try again.",
      );
    setPassword(result.body.temporaryPassword);
  }

  async function copy() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const close = () => {
    if (!pending) onClose();
  };

  if (password) {
    return (
      <Dialog
        open
        onClose={close}
        title={`Temporary password for ${name}`}
        description="Give it to them in person or by phone. It is shown only now. They choose a new password when they next sign in."
      >
        {/* `text-lg` is off Rasi's type scale, and stays deliberately: the
            nearest token, `text-title`, wraps a 12-character password onto
            two lines in this dialog at 360px, which is wrong for something
            read aloud down a phone. Measured by the legibility test in
            `apps/offline-e2e/layout-tests/reset-password-dialog.spec.ts`;
            the scale has no size between body and title to use instead. */}
        <p
          className="rounded-control border border-border bg-surface-sunken px-3 py-3 text-center font-mono text-lg tracking-wider text-ink select-all"
          aria-label="Temporary password"
        >
          {password}
        </p>
        <p role="status" className="sr-only">
          {copied ? "Copied" : ""}
        </p>
        <DialogActions>
          <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
          <Button tone="primary" onClick={close}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={close}
      title={`Reset the password for ${name}`}
      description={`${name} is signed out on every device straight away, and can sign in only with the temporary password you are given next.`}
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button tone="danger" onClick={reset} disabled={pending}>
          {pending ? "Resetting…" : "Reset and sign out"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
