"use client";

import { type StaffDetail, staffContract } from "@repo/contracts";
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
import { formatMobile } from "../../../lib/format";
import { creatableRoles, type Role, ROLE_LABEL } from "../../../lib/roles";

type Status = StaffDetail["status"];

const STATUS_LABEL: Record<Status, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  INACTIVE: "Inactive",
};

/**
 * "Add staff" (US-092). The password is not a field: the API issues a
 * temporary one, shown once on the second step, and the staff member replaces
 * it at their first sign-in — the same forced change an Admin reset uses
 * (US-003), so there is only ever one such flow.
 */
export function AddStaffDialog({
  myRole,
  onClose,
  onAdded,
}: {
  myRole: Role;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [created, setCreated] = useState<{
    staff: StaffDetail;
    temporaryPassword: string;
  } | null>(null);
  const roles = creatableRoles(myRole);
  const form = useZodForm(staffContract.createStaff.body, {
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      role: "JUNIOR",
      joinedAt: "",
    },
  });

  if (created) {
    return (
      <TemporaryPasswordDialog
        name={created.staff.name}
        password={created.temporaryPassword}
        onClose={onAdded}
      />
    );
  }

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title="Add a staff member"
      description="They sign in with their email and a temporary password you pass on, then choose their own."
      submitLabel="Create staff member"
      pendingLabel="Creating…"
      onSubmit={async (body) => {
        const result = await apiWrite(staffContract.createStaff, { body });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["name", "email", "phone", "role", "joinedAt"],
          });
        }
        toast({
          title: `${result.body.staff.name} added`,
          description: `${ROLE_LABEL[result.body.staff.role]} · ${result.body.staff.staffCode}`,
        });
        setCreated(result.body);
      }}
    >
      <FormField name="name" label="Name">
        <Input autoComplete="off" maxLength={120} />
      </FormField>
      <FormField name="email" label="Email" hint="What they sign in with.">
        <Input type="email" autoComplete="off" inputMode="email" />
      </FormField>
      <FormField name="phone" label="Mobile number">
        <Input autoComplete="off" inputMode="tel" />
      </FormField>
      <FormField
        name="role"
        label="Role"
        hint="Only a Senior or a Junior can be assigned to a line."
      >
        <Select>
          {roles.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        name="joinedAt"
        label="Joined on"
        hint="Leave blank for today. An assignment cannot start before this date."
      >
        <Input type="date" />
      </FormField>
    </DialogForm>
  );
}

/** Shown once and never again — the same contract as an Admin reset (US-003). */
function TemporaryPasswordDialog({
  name,
  password,
  onClose,
}: {
  name: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Temporary password for ${name}`}
      description="Give it to them in person or by phone. It is shown only now. They choose a new password when they first sign in."
    >
      <p
        className="rounded-control border border-border bg-surface-sunken px-3 py-3 text-center font-mono text-lg tracking-wider text-ink select-all"
        aria-label="Temporary password"
      >
        {password}
      </p>
      <p role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </p>
      <DialogActions>
        <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
        <Button tone="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Correcting what was typed wrong. Role and status are separate, deliberate acts. */
export function EditStaffDialog({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useZodForm(staffContract.updateStaff.body, {
    defaultValues: { name: staff.name, phone: staff.phone },
  });

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Edit ${staff.name}`}
      description="Their email is what they sign in with and cannot be changed here."
      submitLabel="Save changes"
      pendingLabel="Saving…"
      onSubmit={async (body) => {
        const result = await apiWrite(staffContract.updateStaff, {
          params: { staffProfileId: staff.staffProfileId },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, {
            fields: ["name", "phone"],
          });
        }
        toast({ title: "Details saved" });
        onSaved();
      }}
    >
      <FormField name="name" label="Name">
        <Input autoComplete="off" maxLength={120} />
      </FormField>
      <FormField name="phone" label="Mobile number">
        <Input autoComplete="off" inputMode="tel" />
      </FormField>
    </DialogForm>
  );
}

/**
 * Role change, Super Admin only. It is a permission change, so the dialog says
 * what it grants or takes away rather than only naming the new role; the API
 * refuses it outright while a line assignment the new role could not hold is
 * still open.
 */
export function ChangeRoleDialog({
  staff,
  onClose,
  onChanged,
}: {
  staff: StaffDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const form = useZodForm(staffContract.changeStaffRole.body, {
    defaultValues: { role: staff.role },
  });
  const chosen = form.watch("role");

  return (
    <DialogForm
      form={form}
      onClose={onClose}
      title={`Change ${staff.name}’s role`}
      description={`They are a ${ROLE_LABEL[staff.role]} today. A role decides everything they can see and do.`}
      submitLabel="Change role"
      pendingLabel="Changing…"
      tone="danger"
      onSubmit={async (body) => {
        const result = await apiWrite(staffContract.changeStaffRole, {
          params: { staffProfileId: staff.staffProfileId },
          body,
        });
        if (!result.ok) {
          return applyWriteFailure(form.setError, result, { fields: ["role"] });
        }
        toast({
          title: `${staff.name} is now a ${ROLE_LABEL[result.body.role]}`,
        });
        onChanged();
      }}
    >
      <FormField name="role" label="New role">
        <Select>
          {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </Select>
      </FormField>
      {chosen !== staff.role && staff.currentAssignment ? (
        <FormMessage tone="warning">
          They are the {ROLE_LABEL[staff.currentAssignment.assignmentRole]} on{" "}
          {staff.currentAssignment.lineName}. Assign someone else to that line
          first unless the new role can keep that assignment.
        </FormMessage>
      ) : null}
    </DialogForm>
  );
}

/**
 * Suspending, deactivating and reactivating (US-092).
 *
 * Losing access is immediate and signs every device out, so this is a two-step
 * confirmation whenever the API says the person is still on duty: it refuses
 * with `STAFF_ON_DUTY` and names each reason, and only then is
 * `acknowledgeOnDuty` offered. The confirm button is never the first control
 * in the dialog.
 */
/**
 * US-092 · remove someone who has left for good. Super Admin only, and the
 * API refuses while they hold a line, have cash unacknowledged, or have
 * collections still on their phone — there is no "do it anyway" here.
 */
export function DeleteStaffDialog({
  staff,
  onClose,
  onDeleted,
}: {
  staff: StaffDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[] | null>(null);

  async function confirm() {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(staffContract.deleteStaff, {
      params: { staffProfileId: staff.staffProfileId },
    });
    setPending(false);
    if (!result.ok) {
      if (result.details.length > 0) {
        return setBlocked(result.details.map((detail) => detail.issue));
      }
      return setProblem(result.form ?? "They were not removed.");
    }
    toast({
      title: `${staff.name} removed`,
      description: "Their collections and history are kept.",
    });
    onDeleted();
  }

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={`Remove ${staff.name}?`}
      description="They are signed out everywhere and disappear from the team. Their collections, handovers and audit entries are kept, and this cannot be undone."
    >
      {blocked ? (
        <FormMessage tone="critical">
          <span className="flex flex-col gap-1">
            <span>{staff.name} cannot be removed yet:</span>
            <span className="flex flex-col gap-1 pl-4">
              {blocked.map((issue) => (
                <span key={issue}>· {issue}</span>
              ))}
            </span>
          </span>
        </FormMessage>
      ) : null}
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          {blocked ? "Close" : "Cancel"}
        </Button>
        {blocked ? null : (
          <Button
            tone="danger"
            onClick={() => void confirm()}
            disabled={pending}
          >
            {pending ? "Removing…" : "Remove"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function ChangeStatusDialog({
  staff,
  status,
  onClose,
  onChanged,
}: {
  staff: StaffDetail;
  status: Status;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [onDuty, setOnDuty] = useState<string[] | null>(null);
  const losingAccess = status !== "ACTIVE";

  async function confirm(acknowledgeOnDuty: boolean) {
    setPending(true);
    setProblem(null);
    const result = await apiWrite(staffContract.changeStaffStatus, {
      params: { staffProfileId: staff.staffProfileId },
      body: { status, acknowledgeOnDuty },
    });
    setPending(false);
    if (!result.ok) {
      if (result.code === "STAFF_ON_DUTY") {
        return setOnDuty(result.details.map((detail) => detail.issue));
      }
      return setProblem(result.form ?? "The change was not saved.");
    }
    toast({
      title: `${staff.name} is now ${STATUS_LABEL[status].toLowerCase()}`,
      description: losingAccess
        ? `Signed out on ${result.body.sessionsRevoked === 1 ? "1 device" : `${result.body.sessionsRevoked} devices`}.`
        : "They can sign in again.",
    });
    onChanged();
  }

  const close = () => {
    if (!pending) onClose();
  };

  if (onDuty) {
    return (
      <Dialog
        open
        onClose={close}
        title={`${staff.name} is still on duty`}
        description="Signing them out now cannot be undone for anything left on their phone."
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink">
          {onDuty.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
        <DialogActions>
          <Button tone="ghost" onClick={close} disabled={pending}>
            Keep them active
          </Button>
          <Button
            tone="danger"
            onClick={() => void confirm(true)}
            disabled={pending}
          >
            {pending
              ? "Saving…"
              : status === "INACTIVE"
                ? "Mark as left anyway"
                : `${STATUS_LABEL[status]} anyway`}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={close}
      title={
        losingAccess
          ? `${status === "SUSPENDED" ? "Suspend" : "Mark"} ${staff.name}${status === "SUSPENDED" ? "?" : " as left?"}`
          : `Reactivate ${staff.name}?`
      }
      description={
        !losingAccess
          ? "They can sign in again with the password they already have. Reset it if they have forgotten it."
          : status === "SUSPENDED"
            ? `Signed out on every device straight away, and they cannot sign in until someone reactivates them. A suspension is temporary — use "Mark as left" when they have gone for good. Their mobile number is ${formatMobile(staff.phone)}.`
            : `They have left the business: signed out on every device straight away, and they cannot sign in again unless someone reactivates them. Their record, collections and history are kept. Their mobile number is ${formatMobile(staff.phone)}.`
      }
    >
      {problem ? <FormMessage tone="critical">{problem}</FormMessage> : null}
      <DialogActions>
        <Button tone="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          tone={losingAccess ? "danger" : "primary"}
          onClick={() => void confirm(false)}
          disabled={pending}
        >
          {pending
            ? "Saving…"
            : !losingAccess
              ? "Reactivate"
              : status === "SUSPENDED"
                ? "Suspend and sign out"
                : "Mark as left and sign out"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
