import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import { AreaChart } from "./area-chart";
import { formatBusinessDate, formatCurrency } from "./format";
import { Meter, RadialMeter } from "./meter";

const SERIES = [
  { id: "collected", label: "Collected", variant: "area" },
  { id: "expected", label: "Expected", variant: "line" },
] as const;

const POINTS = [
  { key: "2026-01-03", values: { collected: "0.00", expected: "0.00" } },
  { key: "2026-01-05", values: { collected: "1350.00", expected: "1400.00" } },
  { key: "2026-01-06", values: { collected: "-50.00", expected: "1400.00" } },
];

function Chart() {
  return (
    <AreaChart
      label="Collected against expected"
      series={SERIES}
      points={POINTS}
      formatValue={formatCurrency}
      formatKey={(key) => formatBusinessDate(key, "day-month")}
      formatKeyLong={(key) => formatBusinessDate(key)}
    />
  );
}

describe("AreaChart", () => {
  it("is an image named by its summary, with every day in a table behind it", () => {
    render(<Chart />);
    const chart = screen.getByRole("img", {
      name: /Collected against expected\. 06 Jan 2026: Collected -₹50\.00, Expected ₹1,400\.00/,
    });
    expect(chart).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Collected against expected",
    });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(POINTS.length + 1);
    expect(within(rows[2]!).getByText("₹1,350.00")).toBeInTheDocument();
  });

  it("reads one day at a time with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Chart />);
    await user.tab();
    expect(screen.getByRole("img")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByText("03 Jan 2026: Collected ₹0.00, Expected ₹0.00"),
    ).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByText("05 Jan 2026: Collected ₹1,350.00, Expected ₹1,400.00"),
    ).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(
      screen.getByText("06 Jan 2026: Collected -₹50.00, Expected ₹1,400.00"),
    ).toBeInTheDocument();
  });

  it("labels the value axis in rounded rupees", () => {
    render(<Chart />);
    expect(screen.getByText("₹2,000")).toBeInTheDocument();
    expect(screen.getByText("₹0")).toBeInTheDocument();
  });
});

describe("meters", () => {
  it("report a share and hold full past a hundred percent", () => {
    render(
      <>
        <Meter value={883} label="Collected of expected" valueText="88.3%" />
        <RadialMeter value={1500} label="Lines closed" valueText="150.0%" />
      </>,
    );
    const bar = screen.getByRole("meter", { name: "Collected of expected" });
    expect(bar).toHaveAttribute("aria-valuenow", "88.3");
    expect(bar).toHaveAttribute("aria-valuetext", "88.3%");
    const ring = screen.getByRole("meter", { name: "Lines closed" });
    expect(ring).toHaveAttribute("aria-valuenow", "100");
    expect(ring).toHaveAttribute("aria-valuetext", "150.0%");
  });
});

describe("AppShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      // Storage may be the throwing stub from a test below.
    }
  });

  function Shell() {
    return (
      <AppShell.Root>
        <AppShell.Sidebar brand={<span>Rasi</span>}>
          <AppShell.NavSection title="Operate">
            <AppShell.NavItem icon={<span />} label="Dashboard" state="current">
              <a href="/dashboard" />
            </AppShell.NavItem>
            <AppShell.NavItem
              icon={<span />}
              label="Notifications"
              state="idle"
              count={3}
            >
              <a href="/notifications" />
            </AppShell.NavItem>
          </AppShell.NavSection>
        </AppShell.Sidebar>
        <AppShell.Body>
          <AppShell.Topbar>
            <AppShell.SidebarToggle />
            <AppShell.TopbarAction
              label="Notifications"
              icon={<span />}
              count={3}
            >
              <a href="/notifications" />
            </AppShell.TopbarAction>
          </AppShell.Topbar>
        </AppShell.Body>
      </AppShell.Root>
    );
  }

  it("marks the current page and names each link, badge included", () => {
    render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Console" });
    expect(
      within(nav).getByRole("link", { name: "Dashboard" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(nav).getByRole("link", { name: /^Notifications\s*3\s*unread$/ }),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("link", { name: "Notifications, 3 unread" }),
    ).toBeInTheDocument();
  });

  it("the toggle collapses the sidebar to a rail and remembers it", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const toggle = screen.getByRole("button", { name: "Navigation labels" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("rasi.console.sidebar")).toBe("rail");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("still toggles when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Shell />);
    const toggle = screen.getByRole("button", { name: "Navigation labels" });
    act(() => {
      fireEvent.click(toggle);
    });
    const after = toggle.getAttribute("aria-expanded");
    act(() => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute("aria-expanded")).not.toBe(after);
  });
});
