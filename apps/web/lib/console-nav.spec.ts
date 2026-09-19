import { describe, expect, it } from "vitest";

import { mobileNav } from "./console-nav";

const hrefs = (items: { href: string }[]) => items.map((item) => item.href);

describe("the phone layout's navigation", () => {
  it("gives every console role the same four tabs, in order", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "SENIOR"] as const) {
      expect(hrefs(mobileNav(role).tabs)).toEqual([
        "/dashboard",
        "/collections",
        "/customers",
        "/cash",
      ]);
    }
  });

  it("names the dashboard tab for what each role lands on", () => {
    expect(mobileNav("SUPER_ADMIN").tabs[0]?.label).toBe("Overview");
    expect(mobileNav("ADMIN").tabs[0]?.label).toBe("Today");
    expect(mobileNav("SENIOR").tabs[0]?.label).toBe("My line");
  });

  it("puts every other area the role may see under More, and no tab twice", () => {
    const more = mobileNav("SUPER_ADMIN").more.flatMap((group) => group.items);
    expect(hrefs(more)).toEqual([
      "/reports",
      "/lines",
      "/sectors",
      "/team",
      "/notifications",
      "/settings/holidays",
      "/settings/audit",
      "/settings/security",
      "/settings",
    ]);
  });

  it("hides from a Senior what the sidebar hides from them", () => {
    const more = hrefs(
      mobileNav("SENIOR").more.flatMap((group) => group.items),
    );
    expect(more).not.toContain("/sectors");
    expect(more).not.toContain("/settings/audit");
    expect(more).not.toContain("/settings/security");
    expect(more).not.toContain("/settings");
    expect(more).toContain("/reports");
  });

  it("offers business settings to the Super Admin alone", () => {
    const adminMore = hrefs(
      mobileNav("ADMIN").more.flatMap((group) => group.items),
    );
    expect(adminMore).not.toContain("/settings");
    expect(adminMore).toContain("/settings/audit");
  });
});
