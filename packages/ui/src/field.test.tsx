import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field } from "./field";
import { Input } from "./input";

describe("Field", () => {
  it("labels its control and points it at the hint", () => {
    render(
      <Field label="Mobile number" hint="10 digits">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Mobile number" });
    expect(input).toHaveAccessibleDescription("10 digits");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("replaces the hint with the error and marks the control invalid", () => {
    render(
      <Field
        label="Code"
        hint="Short and unique"
        error="Code is already in use."
      >
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Code" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Code is already in use.");
    expect(screen.queryByText("Short and unique")).not.toBeInTheDocument();
  });

  it("describes nothing when there is neither hint nor error", () => {
    render(
      <Field label="Name">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});
