import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Checkbox, Choice, Switch } from "./choice";
import { Combobox } from "./combobox";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { Menu } from "./menu";
import { Tabs } from "./tabs";
import { toast, Toaster } from "./toast";

const LINES = [
  { value: "", label: "All lines" },
  { value: "3f1a-a1", label: "Market Road", hint: "LN-07" },
  { value: "9c2b-b2", label: "Bus Stand", hint: "LN-08" },
];

function LinePicker({
  onChange = () => {},
}: {
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Field label="Line">
      <Combobox
        options={LINES}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </Field>
  );
}

describe("Choice", () => {
  it("labels a checkbox and toggles it from the label", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [checked, setChecked] = useState(false);
      return (
        <Choice label="Show inactive" description="Includes deactivated lines.">
          <Checkbox
            checked={checked}
            onCheckedChange={(next) => setChecked(next === true)}
          />
        </Choice>
      );
    }
    render(<Harness />);
    const box = screen.getByRole("checkbox", { name: "Show inactive" });
    expect(box).toHaveAccessibleDescription("Includes deactivated lines.");
    expect(box).not.toBeChecked();
    await user.click(screen.getByText("Show inactive"));
    expect(box).toBeChecked();
  });

  it("gives a switch its label", () => {
    render(
      <Choice label="Alerts">
        <Switch checked onCheckedChange={() => {}} />
      </Choice>,
    );
    expect(screen.getByRole("switch", { name: "Alerts" })).toBeChecked();
  });
});

describe("Combobox", () => {
  it("is labelled by its Field and shows the placeholder until a choice is made", () => {
    render(<LinePicker />);
    const trigger = screen.getByRole("combobox", { name: "Line" });
    expect(trigger).toHaveTextContent("All lines");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("searches labels and hints, and reports the chosen value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LinePicker onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: "Line" }));
    await user.keyboard("LN-08");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Bus Stand");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("9c2b-b2");
    expect(screen.getByRole("combobox", { name: "Line" })).toHaveTextContent(
      "Bus Stand",
    );
  });

  it("does not match text that only appears in a value", async () => {
    const user = userEvent.setup();
    render(<LinePicker />);
    await user.click(screen.getByRole("combobox", { name: "Line" }));
    await user.keyboard("3f1a");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
  });

  it("opens its list inside a dialog, not behind it", async () => {
    const user = userEvent.setup();
    render(
      <Dialog open onClose={() => {}} title="Assign a line">
        <LinePicker />
      </Dialog>,
    );
    await user.click(screen.getByRole("combobox", { name: "Line" }));
    const dialog = screen.getByRole("dialog", { name: "Assign a line" });
    expect(within(dialog).getByRole("listbox")).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  it("shows the chosen panel and reports the change", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Tabs.Root defaultValue="profile" onValueChange={onValueChange}>
        <Tabs.List aria-label="Customer">
          <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
          <Tabs.Trigger value="accounts">Accounts</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="profile">Profile body</Tabs.Content>
        <Tabs.Content value="accounts">Accounts body</Tabs.Content>
      </Tabs.Root>,
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Profile body");
    await user.click(screen.getByRole("tab", { name: "Accounts" }));
    expect(onValueChange).toHaveBeenCalledWith("accounts");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Accounts body");
  });
});

describe("Menu", () => {
  it("runs the chosen action", async () => {
    const user = userEvent.setup();
    const onDeactivate = vi.fn();
    render(
      <Menu.Root>
        <Menu.Trigger>Actions</Menu.Trigger>
        <Menu.Content>
          <Menu.Item>Rename</Menu.Item>
          <Menu.Item tone="danger" onSelect={onDeactivate}>
            Deactivate
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>,
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Deactivate" }));
    expect(onDeactivate).toHaveBeenCalledOnce();
  });
});

describe("toast", () => {
  it("shows a confirmation raised from anywhere", () => {
    render(<Toaster />);
    act(() => toast({ title: "Line LN-07 created" }));
    expect(screen.getByText("Line LN-07 created")).toBeInTheDocument();
  });
});
