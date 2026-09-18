import type { ApiError } from "@repo/contracts";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";

/** What a failed `apiWrite` hands back. */
export interface WriteFailure {
  /** The HTTP status; `null` when Rasi could not be reached. */
  status: number | null;
  form: string | null;
  code: string | null;
  details: NonNullable<ApiError["details"]>;
}

/**
 * Puts a failed write onto a react-hook-form form (ADR-0013): each `400`
 * detail whose field the form shows lands on that field, and everything
 * else — a refusal like `409 SECTOR_CODE_TAKEN`, or a detail for a field the
 * form does not render — lands in `root.server`, so nothing the API said is
 * dropped.
 *
 * The API's path is the form's path (`references.0.mobile`), because both
 * come from the same contract schema. `fields` lists the paths this form
 * renders; `rename` maps an API path to a different form path where they
 * differ.
 */
export function applyWriteFailure<Values extends FieldValues>(
  setError: UseFormSetError<Values>,
  failure: WriteFailure,
  options: {
    fields: readonly FieldPath<Values>[];
    rename?: Partial<Record<string, FieldPath<Values>>>;
    /** Shown when the API gave nothing better to say. */
    fallback?: string;
  },
): void {
  const known = new Set<string>(options.fields);
  const placed = new Set<string>();
  let unplaced = false;

  for (const detail of failure.details) {
    const path = options.rename?.[detail.field] ?? detail.field;
    if (!known.has(path)) {
      unplaced = true;
      continue;
    }
    if (placed.has(path)) continue;
    placed.add(path);
    setError(
      path as FieldPath<Values>,
      { type: "server", message: detail.issue },
      { shouldFocus: placed.size === 1 },
    );
  }

  // A failure fully shown at its fields — a 400, or a refusal such as
  // "email already has an account" that names its field — is said once.
  if (placed.size > 0 && !unplaced) return;
  setError("root.server" as FieldPath<Values>, {
    type: "server",
    message: failure.form ?? options.fallback ?? "The change was not saved.",
  });
}
