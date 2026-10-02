import { describe, expect, it } from "vitest";

import { homeMenu, type MenuContext } from "./home-menu";

const noLine: MenuContext = { line: null };
const keys = (role: Parameters<typeof homeMenu>[0], context = noLine) =>
  homeMenu(role, context).map((tile) => tile.key);

describe("the phone home's menu", () => {
  it("gives the owner the books, the statements and the settings", () => {
    expect(keys("SUPER_ADMIN")).toEqual([
      "collections",
      "approvals",
      "customers",
      "cash",
      "lines",
      "sectors",
      "team",
      "books",
      "expenses",
      "balance-sheet",
      "profit-and-loss",
      "reports",
      "holidays",
      "audit",
      "settings",
    ]);
  });

  it("gives an Admin the books but not the owner's statements or settings", () => {
    const admin = keys("ADMIN");
    expect(admin).toContain("books");
    expect(admin).toContain("audit");
    expect(admin).not.toContain("balance-sheet");
    expect(admin).not.toContain("settings");
  });

  it("never shows a Senior the books, the sectors or the audit log", () => {
    const tiles = keys("SENIOR", {
      line: { lineId: "line-1", businessDate: "2026-09-23" },
    });
    for (const hidden of [
      "books",
      "expenses",
      "sectors",
      "audit",
      "settings",
    ]) {
      expect(tiles).not.toContain(hidden);
    }
    expect(tiles).toContain("day-close");
  });

  it("opens the Senior's own day close for handovers and closing", () => {
    const tiles = homeMenu("SENIOR", {
      line: { lineId: "line-1", businessDate: "2026-09-23" },
    });
    expect(tiles.find((tile) => tile.key === "day-close")?.href).toBe(
      "/lines/line-1/day-closes/2026-09-23",
    );
    expect(tiles.find((tile) => tile.key === "handovers")?.badge).toBe(
      "handovers",
    );
  });

  it("leaves out the line's own tiles for a Senior with no line", () => {
    const tiles = keys("SENIOR");
    expect(tiles).not.toContain("day-close");
    expect(tiles).not.toContain("handovers");
    expect(tiles).toContain("collections");
  });
});
