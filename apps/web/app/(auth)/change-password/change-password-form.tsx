"use client";

import { Button, Form, FormField, FormRootError, Input } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { authClient } from "../../../lib/auth-client";

/** Better Auth's configured minimum (auth.config.ts). */
const MIN_LENGTH = 10;

interface ChangePasswordValues {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

/**
 * US-003 forced password change. Mismatch and length are checked at the field
 * before anything is sent; a wrong temporary password is the API's answer,
 * shown at the top because it concerns what the Admin handed over.
 *
 * Better Auth's client sends the request and there is no contract schema, so
 * the checks are `register` rules on the ADR-0013 form layer. Messages are
 * written to follow the field's label (`validationMessage`).
 */
export function ChangePasswordForm() {
  const router = useRouter();
  // Stays set once the password changed, so the button cannot submit again
  // while the next screen loads.
  const [leaving, setLeaving] = useState(false);
  const form = useForm<ChangePasswordValues>({
    mode: "onTouched",
    shouldFocusError: true,
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  form.register("currentPassword", { required: "is required" });
  form.register("newPassword", {
    required: "is required",
    minLength: {
      value: MIN_LENGTH,
      message: `must be at least ${MIN_LENGTH} characters`,
    },
    validate: (value, values) =>
      value !== values.currentPassword ||
      "must be different from the temporary password",
  });
  form.register("confirm", {
    required: "is required",
    validate: (value, values) =>
      value === values.newPassword || "does not match the new password",
  });

  async function submit({
    currentPassword,
    newPassword,
  }: ChangePasswordValues) {
    let message: string;
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        // A reset already signed every device out; keep it that way.
        revokeOtherSessions: true,
      });
      if (!error) {
        setLeaving(true);
        router.replace("/home");
        return;
      }
      message =
        error.status === 400 || error.status === 401
          ? "The temporary password isn’t right. Check it with your administrator."
          : "The password couldn’t be changed just now. Try again in a moment.";
    } catch {
      message = "Could not reach Rasi. Check your connection and try again.";
    }
    form.setError("root.server", { type: "server", message });
  }

  const pending = form.formState.isSubmitting || leaving;

  return (
    <Form form={form} onSubmit={submit}>
      <FormRootError />
      <FormField<ChangePasswordValues>
        name="currentPassword"
        label="Temporary password"
      >
        <Input type="password" autoComplete="current-password" />
      </FormField>
      <FormField<ChangePasswordValues>
        name="newPassword"
        label="New password"
        hint={`At least ${MIN_LENGTH} characters.`}
      >
        <Input type="password" autoComplete="new-password" />
      </FormField>
      <FormField<ChangePasswordValues>
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
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </Form>
  );
}
