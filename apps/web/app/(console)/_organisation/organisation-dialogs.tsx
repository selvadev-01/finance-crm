"use client";

import {
  type Line,
  organisationContract as org,
  type Sector,
} from "@repo/contracts";
import {
  Button,
  Dialog,
  DialogActions,
  DialogForm,
  FormField,
  FormMessage,
  Input,
  Select,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { apiWrite } from "../../../lib/api-write";
import { applyWriteFailure } from "../../../lib/form-errors";

const CODE_HINT = "Letters, digits and hyphens. It can’t be changed later.";

/**
 * The dialogs behind every sector and line write (US-010, US-011). Each is
 * validated against the contract's own body schema before it is sent, keeps
 * itself open while its request is pending (so a double click or an Escape
 * cannot leave the screen unsure whether the change happened), and shows the
 * API's refusals inside the dialog, where the person can still act on them.
 */
export function CreateSectorDialog({
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (sector: Sector) => void;
}) {
  const form = useZodForm(org.createSector.body, {
    defaultValues: { code: "", name: "" },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="New sector"
      description="A sector groups lines by area."
      submitLabel="Create sector"
      pendingLabel="Creating…"
      onSubmit={async (body) => {
        const result = await apiWrite(org.createSector, { body });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["code", "name"],
          });
        }
        toast({ title: `Sector ${result.body.code} created` });
        onCreated(result.body);
      }}
    >
      <FormField name="code" label="Code" hint={CODE_HINT}>
        <Input autoComplete="off" maxLength={80} />
      </FormField>
      <FormField name="name" label="Name">
        <Input autoComplete="off" maxLength={120} />
      </FormField>
    </DialogForm>
  );
}

export function CreateLineDialog({
  onClose,
  onCreated,
  sectors,
  sectorId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (line: Line) => void;
  /** Active sectors to choose from. */
  sectors: Sector[];
  /** Preselected, when the dialog is opened from a sector. */
  sectorId?: string;
}) {
  const form = useZodForm(org.createLine.body, {
    defaultValues: { sectorId: sectorId ?? "", code: "", name: "" },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="New line"
      description="A line is a collection route within one sector."
      submitLabel="Create line"
      pendingLabel="Creating…"
      onSubmit={async (body) => {
        const result = await apiWrite(org.createLine, { body });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["sectorId", "code", "name"],
          });
        }
        toast({ title: `Line ${result.body.code} created` });
        onCreated(result.body);
      }}
    >
      <FormField name="sectorId" label="Sector">
        <Select>
          <option value="" disabled>
            Choose a sector
          </option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name} ({sector.code})
            </option>
          ))}
        </Select>
      </FormField>
      <FormField name="code" label="Code" hint={CODE_HINT}>
        <Input autoComplete="off" maxLength={80} />
      </FormField>
      <FormField name="name" label="Name">
        <Input autoComplete="off" maxLength={120} />
      </FormField>
    </DialogForm>
  );
}

type Renameable =
  { kind: "sector"; record: Sector } | { kind: "line"; record: Line };

export function RenameDialog({
  onClose,
  onRenamed,
  target,
}: {
  open: boolean;
  onClose: () => void;
  onRenamed: () => void;
  target: Renameable;
}) {
  const noun = target.kind === "sector" ? "sector" : "line";
  const form = useZodForm(org.updateSector.body, {
    defaultValues: { name: target.record.name },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Rename ${noun} ${target.record.code}`}
      description="The code stays the same. Past records keep pointing at this."
      submitLabel="Save name"
      pendingLabel="Saving…"
      onSubmit={async (body) => {
        const result =
          target.kind === "sector"
            ? await apiWrite(org.updateSector, {
                params: { sectorId: target.record.id },
                body,
              })
            : await apiWrite(org.updateLine, {
                params: { lineId: target.record.id },
                body,
              });
        if (!result.ok)
          return applyWriteFailure(form.setError, result, { fields: ["name"] });
        toast({ title: `Renamed to ${body.name}` });
        onRenamed();
      }}
    >
      <FormField name="name" label="Name">
        <Input autoComplete="off" maxLength={120} />
      </FormField>
    </DialogForm>
  );
}

/**
 * Names the consequence (design-system.md rule 7). Deactivation is refused by
 * the API while a sector has active lines or a line has active accounts; that
 * refusal is shown here, with its count, rather than guessed in advance.
 * There is nothing to fill in, so this is a plain confirming dialog.
 */
export function DeactivateDialog({
  onClose,
  onDeactivated,
  target,
}: {
  open: boolean;
  onClose: () => void;
  onDeactivated: () => void;
  target: Renameable;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { code, name } = target.record;

  async function confirm() {
    setPending(true);
    setProblem(null);
    const result =
      target.kind === "sector"
        ? await apiWrite(org.deactivateSector, {
            params: { sectorId: target.record.id },
          })
        : await apiWrite(org.deactivateLine, {
            params: { lineId: target.record.id },
          });
    setPending(false);
    if (!result.ok)
      return setProblem(result.form ?? "The change was not saved.");
    toast({
      title: `${target.kind === "sector" ? "Sector" : "Line"} ${code} deactivated`,
    });
    onDeactivated();
  }

  const close = () => {
    if (!pending) onClose();
  };

  const consequence =
    target.kind === "sector"
      ? `${name} will take no new lines. Its lines must already be inactive. Nothing is deleted, and its history stays.`
      : `${name} will take no new customers or accounts. It must have no active accounts. Nothing is deleted, and its collections stay attributed to it.`;

  return (
    <Dialog
      open
      onClose={close}
      title={`Deactivate ${target.kind} ${code}`}
      description={consequence}
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button tone="danger" onClick={() => void confirm()} disabled={pending}>
          {pending ? "Deactivating…" : `Deactivate ${code}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
