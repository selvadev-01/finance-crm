import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";
import { Button, buttonClass } from "./button";
import { cn } from "./cn";

describe("Button", () => {
  it("does not submit a form unless asked to", () => {
    render(
      <form>
        <Button>Cancel</Button>
        <Button type="submit">Save</Button>
      </form>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "type",
      "button",
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("reads its height from the density variables, never a fixed size", () => {
    expect(buttonClass("primary")).toContain("h-[var(--control-height)]");
    expect(buttonClass("primary", undefined, "sm")).toContain(
      "h-[var(--control-height-sm)]",
    );
  });

  it("lets a caller's class win over the variant's", () => {
    render(<Button className="w-full px-0">Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.className).toContain("px-0");
    expect(button.className).not.toContain("px-[var(--control-padding-x)]");
  });
});

describe("Badge", () => {
  it("adds a status dot for a tone, hidden from assistive technology", () => {
    const { container } = render(<Badge tone="critical">Missed</Badge>);
    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden]")).toHaveClass(
      "bg-critical-bright",
    );
  });

  it("leaves the dot out when the badge brings its own mark", () => {
    const { container } = render(
      <Badge tone="info" mark="none">
        <svg aria-hidden data-testid="spinner" />
        Syncing
      </Badge>,
    );
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(1);
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("has no dot when there is nothing to report", () => {
    const { container } = render(<Badge>Open</Badge>);
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });
});

describe("cn", () => {
  it("keeps a role text size beside a text colour", () => {
    expect(cn("text-label text-ink")).toBe("text-label text-ink");
    expect(cn("text-body", "text-caption")).toBe("text-caption");
  });

  it("merges the theme's radius and shadow utilities", () => {
    expect(cn("rounded-control", "rounded-surface")).toBe("rounded-surface");
    expect(cn("shadow-raised", "shadow-overlay")).toBe("shadow-overlay");
  });
});
