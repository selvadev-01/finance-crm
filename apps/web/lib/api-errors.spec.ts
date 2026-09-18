import type { ApiError } from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { describeWriteFailure, fieldMessage } from "./api-errors";

function body(
  details: ApiError["details"],
  message = "Check the highlighted fields.",
): ApiError {
  return { code: "VALIDATION_FAILED", message, details, correlationId: "c-1" };
}

describe("fieldMessage", () => {
  it("puts the label in front of an issue written to follow it", () => {
    expect(fieldMessage("Code", "is already in use")).toBe(
      "Code is already in use.",
    );
    expect(fieldMessage("Effective date", "must be after 1 Sep 2026")).toBe(
      "Effective date must be after 1 Sep 2026.",
    );
  });

  it("shows an issue that stands alone as its own sentence", () => {
    expect(fieldMessage("Reason", "a reason is required")).toBe(
      "A reason is required.",
    );
    expect(fieldMessage("Note", "say what is wrong")).toBe(
      "Say what is wrong.",
    );
  });

  it("does not add a second full stop", () => {
    expect(fieldMessage("Amount", "Too small.")).toBe("Too small.");
  });
});

describe("describeWriteFailure", () => {
  it("places an error for any field the form names, not only the organisation ones", () => {
    const result = describeWriteFailure(
      400,
      body([
        { field: "reason", issue: "a reason is required" },
        { field: "correctedAmount", issue: "must differ from 500.00" },
      ]),
      { reason: "Reason", correctedAmount: "Amount" },
    );
    expect(result).toEqual({
      fields: {
        reason: "A reason is required.",
        correctedAmount: "Amount must differ from 500.00.",
      },
      form: null,
    });
  });

  it("places a nested field by its full path", () => {
    const result = describeWriteFailure(
      400,
      body([{ field: "references.0.name", issue: "is required" }]),
      {
        "references.0.name": "First reference’s name",
      },
    );
    expect(result.fields).toEqual({
      "references.0.name": "First reference’s name is required.",
    });
  });

  it("keeps the form message when a detail has no field on the form to show it", () => {
    const result = describeWriteFailure(
      400,
      body([
        { field: "reason", issue: "a reason is required" },
        { field: "counts.2.count", issue: "must be a whole number" },
      ]),
      { reason: "Reason" },
    );
    expect(result).toEqual({
      fields: { reason: "A reason is required." },
      form: "Check the highlighted fields.",
    });
  });

  it("falls back to the organisation fields when a form names none", () => {
    const result = describeWriteFailure(
      409,
      body([{ field: "code", issue: "is already in use" }], "Code taken."),
    );
    expect(result).toEqual({
      fields: { code: "Code is already in use." },
      form: "Code taken.",
    });
  });

  it("keeps only the first issue for a field", () => {
    const result = describeWriteFailure(
      400,
      body([
        { field: "note", issue: "say what is wrong" },
        { field: "note", issue: "is too long" },
      ]),
      { note: "Note" },
    );
    expect(result.fields).toEqual({ note: "Say what is wrong." });
  });

  it("does not treat inherited object keys as field labels", () => {
    const result = describeWriteFailure(
      400,
      body([{ field: "toString", issue: "is odd" }]),
      {},
    );
    expect(result).toEqual({
      fields: {},
      form: "Check the highlighted fields.",
    });
  });

  it("says the record is gone on a 404, and try again on a 5xx or no body", () => {
    expect(describeWriteFailure(404, body([])).form).toMatch(
      /no longer exists/,
    );
    expect(describeWriteFailure(503, body([])).form).toMatch(/Try again/);
    expect(describeWriteFailure(500, null)).toEqual({
      fields: {},
      form: expect.stringMatching(/Try again/),
    });
  });
});
