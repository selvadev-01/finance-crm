import type { ApiError } from "@repo/contracts";

/** Field name → what is wrong with it, from a `400`'s `details`. */
export type FieldErrors = Record<string, string>;

const ISSUE_LABELS: Record<string, string> = {
  code: "Code",
  name: "Name",
  sectorId: "Sector",
  lineId: "Line",
  staffProfileId: "Staff member",
  effectiveFrom: "Effective date",
};

/**
 * Splits a failed write into what belongs at a field and what belongs at the
 * top of the form. Refusals such as `409 SECTOR_CODE_TAKEN` or
 * `422 LINE_HAS_ACTIVE_ACCOUNTS` carry a message written for the person using
 * the screen (api-design.md#errors), so it is shown as returned rather than
 * reworded here.
 */
export function describeWriteFailure(
  status: number,
  body: ApiError | null,
): { fields: FieldErrors; form: string | null } {
  if (!body) {
    return {
      fields: {},
      form: "The change couldn’t be saved just now. Try again in a moment.",
    };
  }
  const fields: FieldErrors = {};
  for (const detail of body.details ?? []) {
    if (detail.field in ISSUE_LABELS && !(detail.field in fields)) {
      fields[detail.field] = `${ISSUE_LABELS[detail.field]} ${detail.issue}.`;
    }
  }
  if (status === 400 && Object.keys(fields).length > 0) {
    return { fields, form: null };
  }
  if (status === 404) {
    return {
      fields,
      form: "This no longer exists, or is outside your access. Reload the page.",
    };
  }
  if (status >= 500) {
    return {
      fields,
      form: "The change couldn’t be saved just now. Try again in a moment.",
    };
  }
  return { fields, form: body.message };
}
