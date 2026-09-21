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

/**
 * Where Better Auth sends the browser once the link in the email is followed:
 * the page below reads the `?token=` it arrives with.
 */
const RESET_PATH = "/reset-password";

/** `RESET_LINK_MINUTES` in apps/api/src/auth/password-reset.ts. */
const LINK_MINUTES = 30;

interface ForgotPasswordValues {
  email: string;
}

/**
 * US-003 self-service reset, first half. Open to all four roles (decided
 * 2026-09-20).
 *
 * **The answer is the same whether or not the account exists** — the API says
 * so too, and queues nothing for a suspended or deleted staff member. Telling
 * someone which addresses are real would hand a stranger the staff list.
 *
 * Better Auth's client sends the request, not a contract route, so the checks
 * are `register` rules on the ADR-0013 form layer.
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordValues>({
    mode: "onTouched",
    shouldFocusError: true,
    defaultValues: { email: "" },
  });
  form.register("email", {
    required: "is required",
    validate: (value) => value.includes("@") || "must be an email address",
  });

  async function submit({ email }: ForgotPasswordValues) {
    let message: string;
    try {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: RESET_PATH,
      });
      if (!error) {
        setSent(true);
        return;
      }
      message =
        error.status === 429
          ? "That’s been asked for a few times just now. Wait a minute and try again."
          : "The link couldn’t be sent just now. Try again in a moment.";
    } catch {
      message = "Could not reach Rasi. Check your connection and try again.";
    }
    form.setError("root.server", { type: "server", message });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-[var(--stack-gap)]">
        {/* `role="status"`, so the answer is announced when the form it
            replaces disappears — as the sign-up screen's panel is. */}
        <FormMessage tone="info">
          If that email has a Rasi account, a link to set a new password is on
          its way. It works once and lasts {LINK_MINUTES} minutes.
        </FormMessage>
        <p className="text-body text-ink-muted">
          Nothing arrives? Field phones are often set up with an office email
          address. Ask your administrator to reset your password for you.
        </p>
        <Link href="/sign-in" className="font-medium text-accent underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  const pending = form.formState.isSubmitting;

  return (
    <Form form={form} onSubmit={submit}>
      <FormRootError />
      <FormField<ForgotPasswordValues> name="email" label="Email">
        <Input type="email" autoComplete="username" inputMode="email" />
      </FormField>
      <Button
        tone="primary"
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="w-full"
      >
        {pending ? "Sending…" : "Send the link"}
      </Button>
    </Form>
  );
}
