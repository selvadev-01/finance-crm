import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Tour, type TourLabels, type TourStep } from "./tour";

const labels: TourLabels = {
  back: "Back",
  next: "Next",
  done: "Got it",
  close: "Close tour",
  progress: (step, total) => `Step ${step} of ${total}`,
};

/** jsdom draws nothing; give an element a box so the tour can point at it. */
function drawn(testId: string) {
  const element = document.createElement("div");
  element.dataset.testid = testId;
  element.getBoundingClientRect = () => new DOMRect(40, 80, 200, 60);
  document.body.append(element);
  return element;
}

describe("Tour", () => {
  it("walks the steps in order and closes on the last", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Tour
        labels={labels}
        onClose={onClose}
        steps={[
          { title: "Welcome", body: "First" },
          { title: "Filters", body: "Second" },
        ]}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Welcome" })).toHaveTextContent(
      "Step 1 of 2",
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves out a step whose part is not on the page", () => {
    const element = drawn("here");
    const steps: TourStep[] = [
      { target: '[data-testid="here"]', title: "On screen", body: "" },
      { target: '[data-testid="missing"]', title: "Not here", body: "" },
      { title: "The end", body: "" },
    ];
    render(<Tour labels={labels} onClose={() => {}} steps={steps} />);

    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "The end" })).toBeInTheDocument();
    element.remove();
  });

  it("tries a step's targets in order, so one step serves two layouts", () => {
    const element = drawn("phone-bar");
    render(
      <Tour
        labels={labels}
        onClose={() => {}}
        steps={[
          {
            target: ['[data-testid="sidebar"]', '[data-testid="phone-bar"]'],
            title: "Getting around",
            body: "",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Getting around" }),
    ).toBeInTheDocument();
    element.remove();
  });

  it("closes on Escape and steps with the arrow keys", () => {
    const onClose = vi.fn();
    render(
      <Tour
        labels={labels}
        onClose={onClose}
        steps={[
          { title: "One", body: "" },
          { title: "Two", body: "" },
        ]}
      />,
    );
    const card = screen.getByRole("dialog", { name: "One" });
    fireEvent.keyDown(card, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "Two" })).toBeInTheDocument();
    fireEvent.keyDown(card, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: "One" })).toBeInTheDocument();
    fireEvent.keyDown(card, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("takes focus when it opens and announces each step", () => {
    render(
      <Tour
        labels={labels}
        onClose={() => {}}
        steps={[{ title: "Only", body: "Body" }]}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Only" })).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Body");
    expect(screen.getByText("Step 1 of 1: Only")).toBeInTheDocument();
  });

  it("closes at once when nothing in it can be shown", () => {
    const onClose = vi.fn();
    render(
      <Tour
        labels={labels}
        onClose={onClose}
        steps={[{ target: '[data-testid="gone"]', title: "Gone", body: "" }]}
      />,
    );
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
