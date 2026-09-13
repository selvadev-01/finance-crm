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
  Field,
  FormMessage,
  Input,
  Select,
} from "@repo/ui";
import { type FormEvent, useState } from "react";

import type { FieldErrors } from "../../../lib/api-errors";
import { apiWrite } from "../../../lib/api-write";

interface FormState {
  pending: boolean;
  fields: FieldErrors;
  form: string | null;
}

const IDLE: FormState = { pending: false, fields: {}, form: null };

const CODE_HINT = "Letters, digits and hyphens. It can’t be changed later.";

/**
 * The dialogs behind every sector and line write (US-010, US-011). Each keeps
 * itself open while its request is pending, so a double click or an Escape
 * cannot leave the screen unsure whether the change happened. Refusals from the
 * API are shown inside the dialog, where the person can still act on them.
 */
function useFormState() {
  const [state, setState] = useState<FormState>(IDLE);
  return {
    state,
    start: () => setState({ pending: true, fields: {}, form: null }),
    fail: (fields: FieldErrors, form: string | null) =>
      setState({ pending: false, fields, form }),
    reset: () => setState(IDLE),
  };
}

export function CreateSectorDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (sector: Sector) => void;
}) {
  const { state, start, fail, reset } = useFormState();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start();
    const result = await apiWrite(org.createSector, {
      body: {
        code: String(form.get("code")),
        name: String(form.get("name")),
      },
    });
    if (!result.ok) return fail(result.fields, result.form);
    reset();
    onCreated(result.body);
  }

  const close = () => {
    if (state.pending) return;
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New sector"
      description="A sector groups lines by area."
    >
      <form onSubmit={submit} className="flex flex-col gap-[var(--stack-gap)]">
        {state.form ? <FormMessage tone="critical">{state.form}</FormMessage> : null}
        <Field label="Code" hint={CODE_HINT} error={state.fields.code}>
          <Input name="code" required minLength={2} maxLength={80} autoComplete="off" disabled={state.pending} />
        </Field>
        <Field label="Name" error={state.fields.name}>
          <Input name="name" required maxLength={120} autoComplete="off" disabled={state.pending} />
        </Field>
        <DialogActions>
          <Button tone="ghost" onClick={close} disabled={state.pending}>
            Cancel
          </Button>
          <Button tone="primary" type="submit" disabled={state.pending}>
            {state.pending ? "Creating…" : "Create sector"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function CreateLineDialog({
  open,
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
  const { state, start, fail, reset } = useFormState();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start();
    const result = await apiWrite(org.createLine, {
      body: {
        sectorId: String(form.get("sectorId")),
        code: String(form.get("code")),
        name: String(form.get("name")),
      },
    });
    if (!result.ok) return fail(result.fields, result.form);
    reset();
    onCreated(result.body);
  }

  const close = () => {
    if (state.pending) return;
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New line"
      description="A line is a collection route within one sector."
    >
      <form onSubmit={submit} className="flex flex-col gap-[var(--stack-gap)]">
        {state.form ? <FormMessage tone="critical">{state.form}</FormMessage> : null}
        <Field label="Sector" error={state.fields.sectorId}>
          <Select name="sectorId" required defaultValue={sectorId ?? ""} disabled={state.pending}>
            <option value="" disabled>
              Choose a sector
            </option>
            {sectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name} ({sector.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Code" hint={CODE_HINT} error={state.fields.code}>
          <Input name="code" required minLength={2} maxLength={80} autoComplete="off" disabled={state.pending} />
        </Field>
        <Field label="Name" error={state.fields.name}>
          <Input name="name" required maxLength={120} autoComplete="off" disabled={state.pending} />
        </Field>
        <DialogActions>
          <Button tone="ghost" onClick={close} disabled={state.pending}>
            Cancel
          </Button>
          <Button tone="primary" type="submit" disabled={state.pending}>
            {state.pending ? "Creating…" : "Create line"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

type Renameable =
  | { kind: "sector"; record: Sector }
  | { kind: "line"; record: Line };

export function RenameDialog({
  open,
  onClose,
  onRenamed,
  target,
}: {
  open: boolean;
  onClose: () => void;
  onRenamed: () => void;
  target: Renameable;
}) {
  const { state, start, fail, reset } = useFormState();
  const noun = target.kind === "sector" ? "sector" : "line";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    start();
    const result =
      target.kind === "sector"
        ? await apiWrite(org.updateSector, {
            params: { sectorId: target.record.id },
            body: { name },
          })
        : await apiWrite(org.updateLine, {
            params: { lineId: target.record.id },
            body: { name },
          });
    if (!result.ok) return fail(result.fields, result.form);
    reset();
    onRenamed();
  }

  const close = () => {
    if (state.pending) return;
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Rename ${noun} ${target.record.code}`}
      description="The code stays the same. Past records keep pointing at this."
    >
      <form onSubmit={submit} className="flex flex-col gap-[var(--stack-gap)]">
        {state.form ? <FormMessage tone="critical">{state.form}</FormMessage> : null}
        <Field label="Name" error={state.fields.name}>
          <Input
            name="name"
            required
            maxLength={120}
            autoComplete="off"
            defaultValue={target.record.name}
            disabled={state.pending}
          />
        </Field>
        <DialogActions>
          <Button tone="ghost" onClick={close} disabled={state.pending}>
            Cancel
          </Button>
          <Button tone="primary" type="submit" disabled={state.pending}>
            {state.pending ? "Saving…" : "Save name"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/**
 * Names the consequence (design-system.md rule 7). Deactivation is refused by
 * the API while a sector has active lines or a line has active accounts; that
 * refusal is shown here, with its count, rather than guessed in advance.
 */
export function DeactivateDialog({
  open,
  onClose,
  onDeactivated,
  target,
}: {
  open: boolean;
  onClose: () => void;
  onDeactivated: () => void;
  target: Renameable;
}) {
  const { state, start, fail, reset } = useFormState();
  const { code, name } = target.record;

  async function confirm() {
    start();
    const result =
      target.kind === "sector"
        ? await apiWrite(org.deactivateSector, {
            params: { sectorId: target.record.id },
          })
        : await apiWrite(org.deactivateLine, {
            params: { lineId: target.record.id },
          });
    if (!result.ok) return fail(result.fields, result.form);
    reset();
    onDeactivated();
  }

  const close = () => {
    if (state.pending) return;
    reset();
    onClose();
  };

  const consequence =
    target.kind === "sector"
      ? `${name} will take no new lines. Its lines must already be inactive. Nothing is deleted, and its history stays.`
      : `${name} will take no new customers or accounts. It must have no active accounts. Nothing is deleted, and its collections stay attributed to it.`;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Deactivate ${target.kind} ${code}`}
      description={consequence}
    >
      {state.form ? <FormMessage tone="critical">{state.form}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={state.pending}>
          Cancel
        </Button>
        <Button tone="danger" onClick={confirm} disabled={state.pending}>
          {state.pending ? "Deactivating…" : `Deactivate ${code}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
