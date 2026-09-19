import { describe, expect, it } from "vitest";

import { filterCountSummary } from "./filter-summary";

describe("a folded filter bar's summary", () => {
  it("says so when nothing narrows the list", () => {
    expect(filterCountSummary({ action: "", from: "" }, "Every entry")).toBe(
      "Every entry",
    );
  });

  it("counts the filters that are set", () => {
    expect(
      filterCountSummary({ action: "CREATE", from: "", to: "" }, "Every entry"),
    ).toBe("1 filter set");
    expect(
      filterCountSummary(
        { action: "CREATE", from: "2026-09-01", to: "" },
        "Every entry",
      ),
    ).toBe("2 filters set");
  });
});
