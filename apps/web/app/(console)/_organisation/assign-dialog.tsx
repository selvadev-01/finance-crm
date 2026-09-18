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
  Combobox,
  Dialog,
  DialogActions,
  DialogForm,
  FormControlField,
  FormField,
  FormMessage,
  formatBusinessDate,
  Input,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { apiWrite } from "../../../lib/api-write";
import { applyWriteFailure } from "../../../lib/form-errors";

type AssignmentRole = "SENIOR" | "JUNIOR";

/**
 * Who is being assigned where. Opened from a person, the line is chosen; opened
 * from a line, the person is — either way the role is fixed by the person
 * (a Senior takes the Senior assignment, a Junior the Junior one, M03).
 */
export type AssignTarget =
  | {
      from: "staff";
      staff: StaffSummary & { role: AssignmentRole };
      lines: Line[];
    }
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

/** The request body plus the line, which travels in the path. */
const assignSchema = org.assignSenior.body.extend({
  lineId: org.assignSenior.pathParams.shape.lineId,
});

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
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const role = target.from === "staff" ? target.staff.role : target.role;
  const roleLabel = role === "SENIOR" ? "Senior" : "Junior";
  const today = toBusinessDate(new Date());

  const form = useZodForm(assignSchema, {
    defaultValues: {
      lineId: target.from === "line" ? target.line.id : "",
      staffProfileId:
        target.from === "staff" ? target.staff.staffProfileId : "",
      effectiveFrom: "",
    },
  });

  if (outcome) {
    return (
      <Dialog open onClose={onAssigned} title="Assignment saved">
        <div className="flex flex-col gap-2 text-body text-ink">
          <p>Takes effect on {formatBusinessDate(outcome.effectiveFrom)}.</p>
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
          <FormMessage tone="warning">
            {outcome.linesWithoutSenior
              .map((id) => lineNames.get(id) ?? "A line")
              .join(", ")}{" "}
            {outcome.linesWithoutSenior.length === 1 ? "has" : "have"} no Senior
            from that date. Assign one before collections start there.
          </FormMessage>
        ) : null}
        <DialogActions>
          <Button tone="primary" onClick={onAssigned}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  const lineOptions =
    target.from === "staff"
      ? target.lines
          .filter((line) => line.isActive)
          .map((line) => ({
            value: line.id,
            label: line.name,
            hint: line.code,
          }))
      : [];
  const candidates =
    target.from === "line"
      ? target.candidates.filter(
          (person) => person.role === role && person.status === "ACTIVE",
        )
      : [];
  const candidateOptions = candidates.map((person) => ({
    value: person.staffProfileId,
    label: person.name,
    hint: person.currentAssignment
      ? `Now on ${person.currentAssignment.lineName}`
      : "No line today",
  }));

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={
        target.from === "staff"
          ? `Assign ${target.staff.name} to a line`
          : `${role === "SENIOR" ? "Assign the Senior for" : "Add a Junior to"} ${target.line.name}`
      }
      description={
        role === "SENIOR"
          ? "A line has one Senior. The current Senior’s assignment ends the day before this one starts."
          : "A Junior works one line. Their current assignment ends the day before this one starts."
      }
      submitLabel="Assign"
      pendingLabel="Assigning…"
      onSubmit={async ({ lineId, ...body }) => {
        const request = { params: { lineId }, body };
        const result =
          role === "SENIOR"
            ? await apiWrite(org.assignSenior, request)
            : await apiWrite(org.assignJunior, request);
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["lineId", "staffProfileId", "effectiveFrom"],
          });
        }
        toast({ title: `${roleLabel} assignment saved` });
        setOutcome({
          effectiveFrom: result.body.assignment.effectiveFrom,
          closed: result.body.closed,
          linesWithoutSenior: result.body.linesWithoutSenior,
        });
      }}
    >
      {target.from === "staff" ? (
        <FormControlField name="lineId" label="Line">
          {({ field, control }) => (
            <Combobox
              {...control}
              options={lineOptions}
              value={field.value}
              onValueChange={field.onChange}
              placeholder="Choose a line"
              searchPlaceholder="Search lines"
              emptyText="No active line matches."
            />
          )}
        </FormControlField>
      ) : (
        <FormControlField
          name="staffProfileId"
          label={roleLabel}
          hint={
            target.candidatesTruncated
              ? `Showing the first ${candidates.length} active ${roleLabel}s. Assign others from their page in Team.`
              : candidates.length === 0
                ? `There are no active ${roleLabel}s to assign.`
                : undefined
          }
        >
          {({ field, control }) => (
            <Combobox
              {...control}
              options={candidateOptions}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={`Choose a ${roleLabel}`}
              searchPlaceholder={`Search ${roleLabel}s`}
              emptyText={`No active ${roleLabel} matches.`}
            />
          )}
        </FormControlField>
      )}

      <div className="flex flex-col gap-1">
        <FormField
          name="effectiveFrom"
          label="Effective from"
          hint="The first day of the new assignment."
        >
          <Input type="date" />
        </FormField>
        <div>
          <Button
            tone="link"
            size="sm"
            onClick={() =>
              form.setValue("effectiveFrom", today, {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
          >
            Use today, {formatBusinessDate(today)}
          </Button>
        </div>
      </div>
    </DialogForm>
  );
}
