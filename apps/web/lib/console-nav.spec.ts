import { describe, expect, it } from "vitest";

import { mobileNav } from "./console-nav";

const hrefs = (items: { href: string }[]) => items.map((item) => item.href);

describe("the phone layout's navigation", () => {
  it("gives each console role the four tabs of its Stitch home, in order", () => {
    expect(hrefs(mobileNav("SUPER_ADMIN").tabs)).toEqual([
      "/dashboard",
      "/collections",
      "/customers",
      "/books",
    ]);
    expect(hrefs(mobileNav("ADMIN").tabs)).toEqual([
      "/dashboard",
      "/collections",
      "/customers",
      "/cash",
    ]);
    expect(hrefs(mobileNav("SENIOR").tabs)).toEqual([
      "/dashboard",
      "/collections",
      "/cash",
      "/customers",
    ]);
  });

  it("calls every role's dashboard tab Home", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "SENIOR"] as const) {
      expect(mobileNav(role).tabs[0]?.label).toBe("Home");
    }
  });

  it("puts every other area the role may see under More, and no tab twice", () => {
    const more = mobileNav("SUPER_ADMIN").more.flatMap((group) => group.items);
    expect(hrefs(more)).toEqual([
      "/cash",
      "/reports",
      "/lines",
      "/sectors",
      "/team",
      "/settings",
    ]);
  });

  it("hides from a Senior what the sidebar hides from them", () => {
    const more = hrefs(
      mobileNav("SENIOR").more.flatMap((group) => group.items),
    );
    expect(more).not.toContain("/sectors");
    expect(more).not.toContain("/books");
    expect(more).toContain("/reports");
  });

  it("gives every console role one Settings item, its parts being tabs", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "SENIOR"] as const) {
      const more = hrefs(mobileNav(role).more.flatMap((group) => group.items));
      expect(more.filter((href) => href.startsWith("/settings"))).toEqual([
        "/settings",
      ]);
    }
  });

  it("no longer offers a notifications page — the bell is the whole surface", () => {
    const more = hrefs(
      mobileNav("SUPER_ADMIN").more.flatMap((group) => group.items),
    );
    expect(more).not.toContain("/notifications");
  });
});
