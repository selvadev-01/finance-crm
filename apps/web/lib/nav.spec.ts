import { describe, expect, it } from "vitest";

import { currentHref } from "./nav";

const HREFS = ["/dashboard", "/settings", "/settings/audit", "/collections"];

describe("currentHref", () => {
  it("picks the most specific link, so a settings page is not also business settings", () => {
    expect(currentHref("/settings/audit", HREFS)).toBe("/settings/audit");
    expect(currentHref("/settings", HREFS)).toBe("/settings");
  });

  it("keeps a sub-page under its section", () => {
    expect(currentHref("/dashboard/sectors", HREFS)).toBe("/dashboard");
    expect(currentHref("/collections/pending-approval", HREFS)).toBe(
      "/collections",
    );
  });

  it("files an account under Customers, where it is reached from", () => {
    const withCustomers = [...HREFS, "/customers"];
    expect(currentHref("/accounts/new", withCustomers)).toBe("/customers");
    expect(currentHref("/accounts/abc-123", withCustomers)).toBe("/customers");
    expect(currentHref("/accountsx", withCustomers)).toBeUndefined();
  });

  it("does not match a path that only shares a prefix", () => {
    expect(currentHref("/dashboards", HREFS)).toBeUndefined();
    expect(currentHref("/team", HREFS)).toBeUndefined();
  });
});
