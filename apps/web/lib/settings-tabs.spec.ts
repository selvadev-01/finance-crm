import { describe, expect, it } from "vitest";

import { firstSettingsTab, settingsTabsFor } from "./settings-tabs";

const hrefs = (role: Parameters<typeof settingsTabsFor>[0]) =>
  settingsTabsFor(role).map((tab) => tab.href);

describe("the Settings tabs", () => {
  it("gives the Super Admin every part of the group", () => {
    expect(hrefs("SUPER_ADMIN")).toEqual([
      "/settings/business",
      "/settings/holidays",
      "/settings/notifications",
      "/settings/audit",
      "/settings/security",
    ]);
  });

  it("keeps business settings from an Admin, who keeps the record tabs", () => {
    expect(hrefs("ADMIN")).toEqual([
      "/settings/holidays",
      "/settings/notifications",
      "/settings/audit",
      "/settings/security",
    ]);
  });

  it("leaves a Senior the two tabs every role may open", () => {
    expect(hrefs("SENIOR")).toEqual([
      "/settings/holidays",
      "/settings/notifications",
    ]);
  });

  it("opens /settings on the first tab the role may see, never a refusal", () => {
    expect(firstSettingsTab("SUPER_ADMIN")).toBe("/settings/business");
    expect(firstSettingsTab("ADMIN")).toBe("/settings/holidays");
    expect(firstSettingsTab("SENIOR")).toBe("/settings/holidays");
  });
});
