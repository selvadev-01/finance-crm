import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Combobox } from "./combobox";
import { fieldMessage, validationMessage } from "./field-message";
import {
  DialogForm,
  Form,
  FormActions,
  FormControlField,
  FormField,
  FormRootError,
  SubmitButton,
  useZodForm,
  type ZodForm,
} from "./form";
import { Input } from "./input";

const lineSchema = z.object({
  code: z.string().trim().min(1).max(12),
  name: z.string().trim().min(1, "a name is required"),
  sectorId: z.string().min(1),
});

type LineForm = ZodForm<typeof lineSchema>;

const SECTORS = [
  { value: "s-1", label: "North" },
  { value: "s-2", label: "South" },
];

function LineFormHarness({
  onSubmit,
  expose,
}: {
  onSubmit: (values: z.output<typeof lineSchema>) => Promise<void> | void;
  expose?: (form: LineForm) => void;
}) {
  const form = useZodForm(lineSchema, {
    defaultValues: { code: "", name: "", sectorId: "" },
  });
  expose?.(form);
  return (
    <Form form={form} onSubmit={onSubmit}>
      <FormField name="code" label="Code" hint="Up to 12 characters.">
        <Input />
      </FormField>
      <FormField name="name" label="Name">
        <Input />
      </FormField>
      <FormControlField name="sectorId" label="Sector">
        {({ field, control }) => (
          <Combobox
            {...control}
            options={SECTORS}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      </FormControlField>
      <FormRootError />
      <FormActions>
        <SubmitButton pendingLabel="Creating…">Create line</SubmitButton>
      </FormActions>
    </Form>
  );
}

describe("field messages", () => {
  it("reads a contract message after the label, or on its own", () => {
    expect(fieldMessage("Code", "is already in use")).toBe(
      "Code is already in use.",
    );
    expect(fieldMessage("Reason", "a reason is required")).toBe(
      "A reason is required.",
    );
  });

  it("rewords zod's developer messages for an empty field", () => {
    expect(
      validationMessage("Code", {
        type: "too_small",
        message: "Too small: expected string to have >=1 characters",
      }),
    ).toBe("Code is required.");
    expect(
      validationMessage("Code", {
        type: "too_big",
        message: "Too big: expected string to have <=12 characters",
      }),
    ).toBe("Check code.");
  });
});

describe("Form", () => {
  it("shows an error when a required field is left empty, and replaces the hint", async () => {
    const user = userEvent.setup();
    render(<LineFormHarness onSubmit={vi.fn()} />);
    const code = screen.getByRole("textbox", { name: "Code" });
    expect(code).toHaveAccessibleDescription("Up to 12 characters.");
    await user.click(code);
    await user.tab();
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAccessibleDescription("Code is required.");
  });

  it("focuses the first invalid field on submit and does not submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LineFormHarness onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox", { name: "Code" }), "LN-07");
    await user.click(screen.getByRole("button", { name: "Create line" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus(),
    );
    expect(
      screen.getByRole("textbox", { name: "Name" }),
    ).toHaveAccessibleDescription("Name is required.");
    const sector = screen.getByRole("combobox", { name: "Sector" });
    expect(sector).toHaveAttribute("aria-invalid", "true");
    expect(sector).toHaveAccessibleDescription("Sector is required.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the parsed values, trimmed by the schema", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LineFormHarness onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox", { name: "Code" }), " LN-07 ");
    await user.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Market Road",
    );
    await user.click(screen.getByRole("combobox", { name: "Sector" }));
    await user.click(screen.getByRole("option", { name: "South" }));
    await user.click(screen.getByRole("button", { name: "Create line" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      code: "LN-07",
      name: "Market Road",
      sectorId: "s-2",
    });
  });

  it("shows server errors on the field and on the form", async () => {
    let form: LineForm | undefined;
    render(<LineFormHarness onSubmit={vi.fn()} expose={(f) => (form = f)} />);
    act(() => {
      form?.setError("code", { type: "server", message: "is already in use" });
      form?.setError("root.server", {
        type: "warning",
        message: "That sector is inactive.",
      });
    });
    expect(
      screen.getByRole("textbox", { name: "Code" }),
    ).toHaveAccessibleDescription("Code is already in use.");
    expect(screen.getByRole("status")).toHaveTextContent(
      "That sector is inactive.",
    );
  });
});

describe("DialogForm", () => {
  function Harness({
    onSubmit,
    onClose,
  }: {
    onSubmit: () => Promise<void>;
    onClose: () => void;
  }) {
    const form = useZodForm(
      z.object({ reason: z.string().trim().min(1, "a reason is required") }),
      {
        defaultValues: { reason: "" },
      },
    );
    return (
      <DialogForm
        form={form}
        onSubmit={onSubmit}
        onClose={onClose}
        title="Reopen LN-07 for 16 Sep 2026"
        submitLabel="Reopen day"
        pendingLabel="Reopening…"
        tone="danger"
      >
        <FormField name="reason" label="Reason">
          <Input />
        </FormField>
      </DialogForm>
    );
  }

  it("will not close while the write is in flight", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const onSubmit = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const onClose = vi.fn();
    render(<Harness onSubmit={onSubmit} onClose={onClose} />);
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Late collection",
    );
    await user.click(screen.getByRole("button", { name: "Reopen day" }));
    const pending = await screen.findByRole("button", { name: "Reopening…" });
    expect(pending).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
