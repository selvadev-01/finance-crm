import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  DataView,
  type DataViewColumn,
  FilterBar,
  FilterField,
} from "./data-view";
import { Input } from "./input";

interface Row {
  id: string;
  name: string;
  amount: string;
}

const ROWS: Row[] = [
  { id: "a", name: "Kumar Traders", amount: "500.00" },
  { id: "b", name: "Anbu Tea Stall", amount: "1200.00" },
  { id: "c", name: "Selvi Stores", amount: "250.00" },
];

const COLUMNS: DataViewColumn<Row>[] = [
  { accessorKey: "name", header: "Customer" },
  {
    id: "amount",
    header: "Amount",
    // Sort on paise, not on the string: "1200.00" < "250.00" as text.
    accessorFn: (row) => BigInt(row.amount.replace(".", "")),
    cell: ({ row }) => `₹${row.original.amount}`,
    sortingFn: (a, b) => {
      const x = a.getValue<bigint>("amount");
      const y = b.getValue<bigint>("amount");
      return x === y ? 0 : x < y ? -1 : 1;
    },
    meta: { align: "end" },
  },
];

function bodyNames() {
  const table = screen.getByRole("table", { name: "Customers" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent);
}

describe("DataView", () => {
  it("renders the rows as a captioned table and as cards", () => {
    render(
      <DataView
        caption="Customers"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        complete
      />,
    );
    expect(bodyNames()).toEqual([
      "Kumar Traders",
      "Anbu Tea Stall",
      "Selvi Stores",
    ]);
    const cards = within(
      screen.getByRole("list", { name: "Customers" }),
    ).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(
      within(cards[1] as HTMLElement).getByText("₹1200.00"),
    ).toBeInTheDocument();
  });

  it("sorts a complete list and says which way", async () => {
    const user = userEvent.setup();
    render(
      <DataView
        caption="Customers"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        complete
      />,
    );
    await user.click(screen.getByRole("button", { name: "Amount" }));
    const header = screen.getByRole("columnheader", { name: "Amount" });
    expect(header).toHaveAttribute("aria-sort");
    const order = bodyNames();
    // Numeric order either way, never text order.
    expect([order, [...order].reverse()]).toContainEqual([
      "Selvi Stores",
      "Kumar Traders",
      "Anbu Tea Stall",
    ]);
  });

  it("offers no sorting while more rows exist than are loaded", () => {
    render(
      <DataView
        caption="Customers"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        complete={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Amount" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Amount" }),
    ).not.toHaveAttribute("aria-sort");
  });
});

describe("DataView's phone card", () => {
  it("puts the headline amount beside the name, and labels the rest", () => {
    const columns: DataViewColumn<Row>[] = [
      { accessorKey: "name", header: "Customer" },
      {
        id: "amount",
        header: "Amount",
        cell: ({ row }) => `₹${row.original.amount}`,
        meta: { align: "end", card: "headline" },
      },
      {
        id: "line",
        header: "Line",
        cell: () => "LN-07",
      },
    ];
    render(
      <DataView
        caption="Customers"
        columns={columns}
        rows={ROWS.slice(0, 1)}
        getRowId={(row) => row.id}
        complete
      />,
    );
    const card = within(
      screen.getByRole("list", { name: "Customers" }),
    ).getByRole("listitem");
    // The headline is shown without a label; other fields keep theirs.
    expect(within(card).getByText("₹500.00")).toBeInTheDocument();
    expect(within(card).queryByText("Amount")).not.toBeInTheDocument();
    expect(within(card).getByText("Line")).toBeInTheDocument();
    expect(within(card).getByText("LN-07")).toBeInTheDocument();
  });
});

describe("FilterBar", () => {
  it("folds the filters behind a button that says what they are set to", async () => {
    const user = userEvent.setup();
    render(
      <FilterBar summary="14 to 20 Sep, all lines">
        <FilterField label="From">
          <Input type="date" />
        </FilterField>
      </FilterBar>,
    );
    const toggle = screen.getByRole("button", { name: /Filters/ });
    expect(toggle).toHaveTextContent("14 to 20 Sep, all lines");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("From")).toBeInTheDocument();
  });
});

describe("FilterField", () => {
  it("labels its control", () => {
    render(
      <FilterField label="From">
        <Input type="date" />
      </FilterField>,
    );
    expect(screen.getByLabelText("From")).toHaveAttribute("type", "date");
  });
});
