import { describe, expect, it } from "vitest";

import { decideLayout, parseLayout, suggestLayout } from "./device-layout";

describe("choosing the console layout for a device", () => {
  it("uses the saved choice wherever Rasi is running", () => {
    expect(decideLayout("mobile", false)).toEqual({
      kind: "use",
      layout: "mobile",
    });
    expect(decideLayout("desktop", true)).toEqual({
      kind: "use",
      layout: "desktop",
    });
  });

  it("asks before the installed app first shows the console", () => {
    expect(decideLayout(null, true)).toEqual({ kind: "ask" });
  });

  it("does not interrupt a browser tab: a computer gets the computer layout", () => {
    expect(decideLayout(null, false)).toEqual({
      kind: "use",
      layout: "desktop",
    });
  });

  it("opens a phone's browser tab in the phone layout, unasked", () => {
    expect(decideLayout(null, false, true)).toEqual({
      kind: "use",
      layout: "mobile",
    });
    // A choice made on this phone still wins, and the installed app still asks.
    expect(decideLayout("desktop", false, true)).toEqual({
      kind: "use",
      layout: "desktop",
    });
    expect(decideLayout(null, true, true)).toEqual({ kind: "ask" });
  });

  it("treats anything but the two layouts in storage as no choice", () => {
    expect(parseLayout("mobile")).toBe("mobile");
    expect(parseLayout("desktop")).toBe("desktop");
    expect(parseLayout("tablet")).toBeNull();
    expect(parseLayout(null)).toBeNull();
  });

  it("suggests the phone layout only for a small touch screen", () => {
    expect(suggestLayout({ narrow: true, touch: true })).toBe("mobile");
    expect(suggestLayout({ narrow: true, touch: false })).toBe("desktop");
    expect(suggestLayout({ narrow: false, touch: true })).toBe("desktop");
  });
});
