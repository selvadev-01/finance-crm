"use client";

import { type BusinessSetting, settingsContract } from "@repo/contracts";
import {
  Button,
  Dialog,
  DialogActions,
  DialogForm,
  FormField,
  FormMessage,
  Input,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";

/**
 * Change one setting (US-094). The ranges are the API's — one registry, one
 * set of rules — so a refusal comes back at the `value` field rather than
 * being guessed at here.
 *
 * A `LOCKED` setting that is still editable (the currency, until the first
 * account) says so before it is changed: after that it is history.
 */
export function ChangeSettingDialog({
  setting,
  onClose,
  onChanged,
}: {
  setting: BusinessSetting;
  onClose: () => void;
  onChanged: () => void;
}) {
  const form = useZodForm(settingsContract.updateSetting.body, {
    defaultValues: { value: setting.value },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Change ${setting.label.toLowerCase()}`}
      description={setting.description}
      submitLabel="Save change"
      pendingLabel="Saving…"
      onSubmit={async (body) => {
        const result = await apiWrite(settingsContract.updateSetting, {
          params: { key: setting.key },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["value"],
            fallback: "The setting was not changed.",
          });
        }
        toast({
          title: `${setting.label} saved`,
          description: setting.effect,
        });
        onChanged();
      }}
    >
      {setting.group === "LOCKED" ? (
        <FormMessage tone="warning">
          This can only be corrected while the business has no account. Once the
          first one exists it is history and this becomes read-only.
        </FormMessage>
      ) : null}
      <FormField name="value" label={setting.label} hint={setting.effect}>
        <Input
          autoComplete="off"
          maxLength={200}
          {...(setting.valueType === "INTEGER"
            ? { inputMode: "numeric" as const }
            : {})}
        />
      </FormField>
      {setting.defaultValue !== null ? (
        <p className="text-caption text-ink-muted">
          Rasi’s own default is {setting.defaultValue}.
        </p>
      ) : null}
    </DialogForm>
  );
}

/**
 * Dropping an override goes back to Rasi's built-in default, which is a real
 * change to how the business behaves — so it is confirmed, and it never sits
 * before the ordinary "Change" action on the screen.
 */
export function ResetSettingDialog({
  setting,
  onClose,
  onReset,
}: {
  setting: BusinessSetting;
  onClose: () => void;
  onReset: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(settingsContract.updateSetting, {
      params: { key: setting.key },
      body: { value: null },
    });
    setPending(false);
    if (!result.ok) {
      return setProblem(result.form ?? "The setting was not reset.");
    }
    toast({
      title: `${setting.label} back to ${setting.defaultValue}`,
      description: setting.effect,
    });
    onReset();
  }

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={`Reset ${setting.label.toLowerCase()}?`}
      description={`${setting.label} goes from ${setting.value} back to Rasi’s default of ${setting.defaultValue}. ${setting.effect}`}
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button tone="danger" onClick={() => void confirm()} disabled={pending}>
          {pending ? "Resetting…" : "Reset to default"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
