"use client";

import {
  type Assignment,
  type Line,
  organisationContract as org,
  type StaffSummary,
} from "@repo/contracts";
import { toBusinessDate } from "@repo/domain";
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  FormMessage,
  formatBusinessDate,
  Input,
  Select,
} from "@repo/ui";
import { type FormEvent, useState } from "react";

import type { FieldErrors } from "../../../lib/api-errors";
import { apiWrite } from "../../../lib/api-write";

type AssignmentRole = "SENIOR" | "JUNIOR";

/**
 * Who is being assigned where. Opened from a person, the line is chosen; opened
 * from a line, the person is — either way the role is fixed by the person
 * (a Senior takes the Senior assignment, a Junior the Junior one, M03).
 */
export type AssignTarget =
  | { from: "staff"; staff: StaffSummary & { role: AssignmentRole }; lines: Line[] }
  | {
      from: "line";
      line: Line;
      role: AssignmentRole;
      candidates: StaffSummary[];
      /** More active staff of this role exist than one page holds. */
      candidatesTruncated: boolean;
    };

interface Outcome {
  effectiveFrom: string;
  closed: Assignment[];
  linesWithoutSenior: string[];
}

/**
 * S-15 Assign staff to line (US-012, US-013).
 *
 * **The effective date is never filled in for the Admin** — "the UI never
 * implies now" (M03). "Use today" is one tap, but it is a choice. The API
 * closes whatever the assignment replaces on the day before; the result step
 * says what was closed and names any line left without a Senior, because that
 * is allowed (decided 2026-09-13) and must not happen silently.
 */
export function AssignDialog({
  target,
  lineNames,
  onClose,
  onAssigned,
}: {
  target: AssignTarget;
  /** Line id → name, to name lines left without a Senior. */
  lineNames: Map<string, string>;
  onClose: () => void;
  /** Called once the result has been read and dismissed. */
  onAssigned: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [form, setForm] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const role = target.from === "staff" ? target.staff.role : target.role;
  const roleLabel = role === "SENIOR" ? "Senior" : "Junior";
  const today = toBusinessDate(new Date());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const lineId =
      target.from === "line" ? target.line.id : String(data.get("lineId"));
    const staffProfileId =
      target.from === "staff"
        ? target.staff.staffProfileId
        : String(data.get("staffProfileId"));

    setPending(true);
    setFields({});
    setForm(null);
    const request = {
      params: { lineId },
      body: { staffProfileId, effectiveFrom },
    };
    const result =
      role === "SENIOR"
        ? await apiWrite(org.assignSenior, request)
        : await apiWrite(org.assignJunior, request);
    setPending(false);
    if (!result.ok) {
      setFields(result.fields);
      setForm(result.form);
      return;
    }
    setOutcome({
      effectiveFrom: result.body.assignment.effectiveFrom,
      closed: result.body.closed,
      linesWithoutSenior: result.body.linesWithoutSenior,
    });
  }

  const close = () => {
    if (pending) return;
    if (outcome) onAssigned();
    else onClose();
  };

  const title =
    target.from === "staff"
      ? `Assign ${target.staff.name} to a line`
      : `${role === "SENIOR" ? "Assign the Senior for" : "Add a Junior to"} ${target.line.name}`;

  if (outcome) {
    return (
      <Dialog open onClose={close} title="Assignment saved">
        <div className="flex flex-col gap-2 text-sm text-ink">
          <p>
            Takes effect on {formatBusinessDate(outcome.effectiveFrom)}.
          </p>
          {outcome.closed.map((closed) =>
            closed.effectiveTo ? (
              <p key={closed.id} className="text-ink-muted">
                {closed.assignmentRole === "SENIOR" ? "A Senior" : "A Junior"}{" "}
                assignment on {lineNames.get(closed.lineId) ?? "another line"}{" "}
                now ends on {formatBusinessDate(closed.effectiveTo)}. It is kept
                in the history.
              </p>
            ) : null,
          )}
        </div>
        {outcome.linesWithoutSenior.length > 0 ? (
          <FormMessage tone="critical">
            {outcome.linesWithoutSenior
              .map((id) => lineNames.get(id) ?? "A line")
              .join(", ")}{" "}
            {outcome.linesWithoutSenior.length === 1 ? "has" : "have"} no
            Senior from that date. Assign one before collections start there.
          </FormMessage>
        ) : null}
        <DialogActions>
          <Button tone="primary" onClick={close}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  const activeLines =
    target.from === "staff"
      ? target.lines.filter((line) => line.isActive)
      : [];
  const candidates =
    target.from === "line"
      ? target.candidates.filter(
          (person) => person.role === role && person.status === "ACTIVE",
        )
      : [];

  return (
    <Dialog
      open
      onClose={close}
      title={title}
      description={
        role === "SENIOR"
          ? "A line has one Senior. The current Senior’s assignment ends the day before this one starts."
          : "A Junior works one line. Their current assignment ends the day before this one starts."
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-[var(--stack-gap)]">
        {form ? <FormMessage tone="critical">{form}</FormMessage> : null}

        {target.from === "staff" ? (
          <Field label="Line" error={fields.lineId}>
            <Select name="lineId" required defaultValue="" disabled={pending}>
              <option value="" disabled>
                Choose a line
              </option>
              {activeLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name} ({line.code})
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field
            label={roleLabel}
            hint={
              target.candidatesTruncated
                ? `Showing the first ${candidates.length} active ${roleLabel}s. Assign others from their page in Team.`
                : candidates.length === 0
                  ? `There are no active ${roleLabel}s to assign.`
                  : undefined
            }
            error={fields.staffProfileId}
          >
            <Select
              name="staffProfileId"
              required
              defaultValue=""
              disabled={pending}
            >
              <option value="" disabled>
                Choose a {roleLabel}
              </option>
              {candidates.map((person) => (
                <option key={person.staffProfileId} value={person.staffProfileId}>
                  {person.name}
                  {person.currentAssignment
                    ? ` — now on ${person.currentAssignment.lineName}`
                    : " — no line today"}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="flex flex-col gap-1.5">
          <Field
            label="Effective from"
            hint="The first day of the new assignment."
            error={fields.effectiveFrom}
          >
            <Input
              name="effectiveFrom"
              type="date"
              required
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              disabled={pending}
            />
          </Field>
          <div>
            <Button
              tone="ghost"
              onClick={() => setEffectiveFrom(today)}
              disabled={pending}
              className="-ml-[var(--control-padding-x)]"
            >
              Use today, {formatBusinessDate(today)}
            </Button>
          </div>
        </div>

        <DialogActions>
          <Button tone="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button tone="primary" type="submit" disabled={pending}>
            {pending ? "Assigning…" : "Assign"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
