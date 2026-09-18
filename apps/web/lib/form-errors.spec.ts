import { describe, expect, it, vi } from "vitest";

import { applyWriteFailure, type WriteFailure } from "./form-errors";

type Values = { code: string; name: string; references: { mobile: string }[] };

function failure(overrides: Partial<WriteFailure>): WriteFailure {
  return {
    status: 400,
    form: "Check the highlighted fields.",
    code: "VALIDATION_FAILED",
    details: [],
    ...overrides,
  };
}

describe("applyWriteFailure", () => {
  it("puts each detail on its field, focusing the first, and adds nothing else", () => {
    const setError = vi.fn();
    applyWriteFailure<Values>(
      setError,
      failure({
        details: [
          { field: "code", issue: "is already in use" },
          {
            field: "references.0.mobile",
            issue: "must be a 10-digit mobile number",
          },
          { field: "code", issue: "is too long" },
        ],
      }),
      { fields: ["code", "name", "references.0.mobile"] },
    );
    expect(setError.mock.calls).toEqual([
      [
        "code",
        { type: "server", message: "is already in use" },
        { shouldFocus: true },
      ],
      [
        "references.0.mobile",
        { type: "server", message: "must be a 10-digit mobile number" },
        { shouldFocus: false },
      ],
    ]);
  });

  it("keeps a form-level message when a detail names a field the form does not show", () => {
    const setError = vi.fn();
    applyWriteFailure<Values>(
      setError,
      failure({
        details: [
          { field: "name", issue: "a name is required" },
          { field: "sectorId", issue: "is inactive" },
        ],
      }),
      { fields: ["name"] },
    );
    expect(setError).toHaveBeenLastCalledWith("root.server", {
      type: "server",
      message: "Check the highlighted fields.",
    });
  });

  it("says a refusal that names a shown field once, at the field", () => {
    const setError = vi.fn();
    applyWriteFailure<Values>(
      setError,
      failure({
        status: 409,
        form: "That code is taken.",
        details: [{ field: "code", issue: "is already in use" }],
      }),
      { fields: ["code"] },
    );
    expect(setError).toHaveBeenCalledExactlyOnceWith(
      "code",
      { type: "server", message: "is already in use" },
      { shouldFocus: true },
    );
  });

  it("shows a refusal at the top of the form", () => {
    const setError = vi.fn();
    applyWriteFailure<Values>(
      setError,
      failure({
        status: 409,
        code: "DUPLICATE_MOBILE",
        form: "This mobile number is already a customer's.",
      }),
      { fields: ["name"] },
    );
    expect(setError).toHaveBeenCalledExactlyOnceWith("root.server", {
      type: "server",
      message: "This mobile number is already a customer's.",
    });
  });

  it("maps an API path to a differently named form field", () => {
    const setError = vi.fn();
    applyWriteFailure<Values>(
      setError,
      failure({ details: [{ field: "lineCode", issue: "is taken" }] }),
      {
        fields: ["code"],
        rename: { lineCode: "code" },
      },
    );
    expect(setError).toHaveBeenCalledExactlyOnceWith(
      "code",
      { type: "server", message: "is taken" },
      { shouldFocus: true },
    );
  });

  it("falls back to its own message when Rasi could not be reached", () => {
    const setError = vi.fn();
    applyWriteFailure<Values>(
      setError,
      failure({ status: null, form: null, code: null }),
      {
        fields: ["name"],
        fallback: "The customer was not saved.",
      },
    );
    expect(setError).toHaveBeenCalledExactlyOnceWith("root.server", {
      type: "server",
      message: "The customer was not saved.",
    });
  });
});
