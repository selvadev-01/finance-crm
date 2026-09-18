"use client";

import { type Holiday, holidayContract, type Sector } from "@repo/contracts";
import {
  Button,
  Dialog,
  DialogActions,
  DialogForm,
  FormField,
  FormMessage,
  formatBusinessDate,
  Input,
  Select,
  toast,
  useZodForm,
} from "@repo/ui";
import { useState } from "react";

import { apiWrite } from "../../../../lib/api-write";
import { applyWriteFailure } from "../../../../lib/form-errors";

const accounts = (count: number) =>
  count === 0
    ? "No account’s schedule needed to move."
    : `${count} ${count === 1 ? "account’s schedule" : "accounts’ schedules"} moved.`;

/**
 * "Add holiday" (US-093), validated against the contract's own body schema.
 * The date's rules — future only, not a Sunday, not already a holiday — are
 * the API's, shown at the date field when it refuses.
 */
export function AddHolidayDialog({
  sectors,
  onClose,
  onAdded,
}: {
  /** Active sectors to choose from; empty until they load. */
  sectors: Sector[];
  onClose: () => void;
  onAdded: (holiday: Holiday) => void;
}) {
  const form = useZodForm(holidayContract.declareHoliday.body, {
    defaultValues: { date: "", name: "", sectorId: "" },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="Add holiday"
      description="No collections are due that day. Pending collections from that day on move to the next working day, and staff on the lines it covers are told."
      submitLabel="Add holiday"
      pendingLabel="Adding…"
      onSubmit={async (body) => {
        const result = await apiWrite(holidayContract.declareHoliday, {
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["date", "name", "sectorId"],
          });
        }
        toast({
          title: `${result.body.name} added for ${formatBusinessDate(result.body.date)}`,
          description: accounts(result.body.accountsShifted),
        });
        onAdded(result.body);
      }}
    >
      <FormField
        name="date"
        label="Date"
        hint="A future date. Sundays are never collection days already."
      >
        <Input type="date" />
      </FormField>
      <FormField
        name="name"
        label="Name"
        hint="Juniors see it on their route: “Today is a holiday: …”"
      >
        <Input autoComplete="off" maxLength={120} />
      </FormField>
      <FormField
        name="sectorId"
        label="Applies to"
        hint="A local festival can close one sector only."
      >
        <Select>
          <option value="">All sectors (business-wide)</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name} ({sector.code})
            </option>
          ))}
        </Select>
      </FormField>
    </DialogForm>
  );
}

/**
 * Names the consequence (design-system.md rule 7). Only a future holiday is
 * offered; the API refuses anything else regardless.
 */
export function RemoveHolidayDialog({
  holiday,
  onClose,
  onRemoved,
}: {
  holiday: Holiday;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const day = formatBusinessDate(holiday.date);
  const scope = holiday.sector ? `in ${holiday.sector.name}` : "business-wide";

  async function confirm() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(holidayContract.removeHoliday, {
      params: { holidayId: holiday.id },
    });
    setPending(false);
    if (!result.ok)
      return setProblem(result.form ?? "The holiday was not removed.");
    toast({
      title: `${holiday.name} removed`,
      description: accounts(result.body.accountsShifted),
    });
    onRemoved();
  }

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={`Remove ${holiday.name}?`}
      description={`${day} becomes a working day again ${scope}. Pending collections from that day on move back a day, and staff on the lines it covers are told.`}
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button tone="danger" onClick={() => void confirm()} disabled={pending}>
          {pending ? "Removing…" : "Remove holiday"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
