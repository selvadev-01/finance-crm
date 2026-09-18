import type { ApiError } from "@repo/contracts";
import { fieldMessage } from "@repo/ui/field-message";

/** Field name → what is wrong with it, from a `400`'s `details`. */
export type FieldErrors = Record<string, string>;

/**
 * The fields a form shows, keyed by the API's field path (`references.0.name`
 * for nested ones), with the label the person sees. Only these are placed at a
 * field; any other detail is left to the form-level message so it is never
 * dropped on the floor.
 */
export type FieldLabels = Readonly<Record<string, string>>;

/** The organisation dialogs' fields — the default when a form names none. */
export const ORGANISATION_FIELD_LABELS: FieldLabels = {
  code: "Code",
  name: "Name",
  sectorId: "Sector",
  lineId: "Line",
  staffProfileId: "Staff member",
  effectiveFrom: "Effective date",
};

// The same wording rule the form layer uses for its own checks.
export { fieldMessage } from "@repo/ui/field-message";

const UNAVAILABLE =
  "The change couldn’t be saved just now. Try again in a moment.";

/**
 * Splits a failed write into what belongs at a field and what belongs at the
 * top of the form. Refusals such as `409 SECTOR_CODE_TAKEN` or
 * `422 LINE_HAS_ACTIVE_ACCOUNTS` carry a message written for the person using
 * the screen (api-design.md#errors), so it is shown as returned rather than
 * reworded here.
 *
 * A form-level message is kept whenever some detail has no field on the form
 * to show it — otherwise a `400` for a field the form does not render would
 * look like nothing happened.
 */
export function describeWriteFailure(
  status: number,
  body: ApiError | null,
  labels: FieldLabels = ORGANISATION_FIELD_LABELS,
): { fields: FieldErrors; form: string | null } {
  if (!body) return { fields: {}, form: UNAVAILABLE };

  const fields: FieldErrors = {};
  let unplaced = false;
  for (const detail of body.details ?? []) {
    const label = Object.hasOwn(labels, detail.field)
      ? labels[detail.field]
      : undefined;
    if (label === undefined) {
      unplaced = true;
    } else if (!(detail.field in fields)) {
      fields[detail.field] = fieldMessage(label, detail.issue);
    }
  }

  if (status === 404) {
    return {
      fields,
      form: "This no longer exists, or is outside your access. Reload the page.",
    };
  }
  if (status >= 500) return { fields, form: UNAVAILABLE };
  if (status === 400 && Object.keys(fields).length > 0 && !unplaced) {
    return { fields, form: null };
  }
  return { fields, form: body.message };
}
