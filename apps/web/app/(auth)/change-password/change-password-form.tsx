"use client";

import { Button, Field, FormMessage, Input } from "@repo/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { flushSync } from "react-dom";

import { authClient } from "../../../lib/auth-client";

/** Better Auth's configured minimum (auth.config.ts). */
const MIN_LENGTH = 10;

interface Errors {
  newPassword?: string;
  confirm?: string;
  form?: string;
}

/**
 * US-003 forced password change. Mismatch and length are checked at the field
 * before anything is sent; a wrong temporary password is the API's answer,
 * shown at the top because it concerns what the Admin handed over.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const currentPassword = String(form.get("currentPassword"));
    const newPassword = String(form.get("newPassword"));
    const confirm = String(form.get("confirm"));

    const found: Errors = {};
    if (newPassword.length < MIN_LENGTH) {
      found.newPassword = `Use at least ${MIN_LENGTH} characters.`;
    } else if (newPassword === currentPassword) {
      found.newPassword = "Choose a password different from the temporary one.";
    }
    if (confirm !== newPassword) {
      found.confirm = "This doesn’t match the new password.";
    }
    // Commit synchronously so the field's aria-describedby points at the error
    // before focus lands on it.
    flushSync(() => setErrors(found));
    if (Object.keys(found).length > 0) {
      // Move focus to the first invalid field so its error is announced.
      const first = found.newPassword ? "newPassword" : "confirm";
      element.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setPending(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        // A reset already signed every device out; keep it that way.
        revokeOtherSessions: true,
      });
      if (!error) {
        router.replace("/home");
        return;
      }
      setErrors({
        form:
          error.status === 400 || error.status === 401
            ? "The temporary password isn’t right. Check it with your administrator."
            : "The password couldn’t be changed just now. Try again in a moment.",
      });
    } catch {
      setErrors({
        form: "Could not reach Rasi. Check your connection and try again.",
      });
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--stack-gap)]">
      {errors.form ? (
        <FormMessage tone="critical">{errors.form}</FormMessage>
      ) : null}
      <Field label="Temporary password">
        <Input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </Field>
      <Field
        label="New password"
        hint={`At least ${MIN_LENGTH} characters.`}
        error={errors.newPassword}
      >
        <Input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
        />
      </Field>
      <Field label="Confirm new password" error={errors.confirm}>
        <Input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
        />
      </Field>
      <Button
        tone="primary"
        type="submit"
        disabled={pending}
        className="w-full"
      >
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
}
