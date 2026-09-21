"use client";

import {
  Button,
  Form,
  FormField,
  FormMessage,
  FormRootError,
  Input,
} from "@repo/ui";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { authClient } from "../../../lib/auth-client";

/** Better Auth's configured minimum (auth.config.ts). */
const MIN_LENGTH = 10;

interface ResetPasswordValues {
  newPassword: string;
  confirm: string;
}

/**
 * US-003 self-service reset, second half: the password chosen through the
 * emailed link.
 *
 * The token arrives in the URL, checked once by Better Auth's callback before
 * the browser gets here and again when it is spent — a link already used, or
 * older than its 30 minutes, is refused at this point and the person is sent
 * back to ask for another.
 *
 * On success every device is signed out, the API side included, so the new
 * password is entered once here and then used to sign in. The success is
 * confirmed here rather than as a flag on `/sign-in`, which stays prerendered.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const form = useForm<ResetPasswordValues>({
    mode: "onTouched",
    shouldFocusError: true,
    defaultValues: { newPassword: "", confirm: "" },
  });
  form.register("newPassword", {
    required: "is required",
    minLength: {
      value: MIN_LENGTH,
      message: `must be at least ${MIN_LENGTH} characters`,
    },
  });
  form.register("confirm", {
    required: "is required",
    validate: (value, values) =>
      value === values.newPassword || "does not match the new password",
  });

  async function submit({ newPassword }: ResetPasswordValues) {
    let message: string;
    try {
      const { error } = await authClient.resetPassword({ newPassword, token });
      if (!error) {
        setDone(true);
        return;
      }
      message =
        error.status === 400
          ? "That link has been used already, or it has expired. Ask for a new one."
          : "The password couldn’t be set just now. Try again in a moment.";
    } catch {
      message = "Could not reach Rasi. Check your connection and try again.";
    }
    form.setError("root.server", { type: "server", message });
  }

  if (done) {
    return (
      <div className="flex flex-col gap-[var(--stack-gap)]">
        {/* `role="status"`, so the confirmation is announced when the form it
            replaces disappears — as the sign-up screen's panel is. */}
        <FormMessage tone="info">
          Your new password is set, and every device has been signed out. Sign
          in with it now.
        </FormMessage>
        <Link href="/sign-in" className="font-medium text-accent underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  const pending = form.formState.isSubmitting;

  return (
    <Form form={form} onSubmit={submit}>
      <FormRootError />
      <FormField<ResetPasswordValues>
        name="newPassword"
        label="New password"
        hint={`At least ${MIN_LENGTH} characters.`}
      >
        <Input type="password" autoComplete="new-password" />
      </FormField>
      <FormField<ResetPasswordValues>
        name="confirm"
        label="Confirm new password"
      >
        <Input type="password" autoComplete="new-password" />
      </FormField>
      <Button
        tone="primary"
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="w-full"
      >
        {pending ? "Saving…" : "Set the password"}
      </Button>
    </Form>
  );
}
