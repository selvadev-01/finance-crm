"use client";

import { DialogForm, FormField, Input } from "@repo/ui";
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
 * Changing your own password from your profile (US-003). The forced change at
 * `/change-password` is the same call with a different story around it: there
 * an Admin has just handed over a temporary password, here nobody has — so the
 * first field is the password in use, and the reader stays where they were.
 *
 * Every other device is signed out, as a reset does: a password is changed
 * because the old one should stop working, and a session outliving it would be
 * the one thing that did not.
 *
 * Better Auth's client sends the request and there is no contract schema, so
 * the checks are `register` rules on the ADR-0013 form layer.
 */
export function ChangePasswordDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
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
      "must be different from your current password",
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
        revokeOtherSessions: true,
      });
      if (!error) {
        onChanged();
        return;
      }
      message =
        error.status === 400 || error.status === 401
          ? "That current password isn’t right. Try again."
          : "The password couldn’t be changed just now. Try again in a moment.";
    } catch {
      message = "Could not reach Rasi. Check your connection and try again.";
    }
    form.setError("root.server", { type: "server", message });
  }

  return (
    <DialogForm
      form={form}
      onSubmit={submit}
      onClose={onClose}
      title="Change your password"
      description="You stay signed in on this device. Every other device is signed out."
      submitLabel="Change password"
      pendingLabel="Changing…"
    >
      <FormField<ChangePasswordValues>
        name="currentPassword"
        label="Current password"
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
    </DialogForm>
  );
}
