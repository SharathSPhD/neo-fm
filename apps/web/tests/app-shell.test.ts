import { describe, expect, it } from "vitest";

import { parseAppShell } from "../lib/native/app-shell";

describe("parseAppShell", () => {
  it("detects the Android and iOS shells", () => {
    expect(parseAppShell("Mozilla/5.0 (Linux; Android 14) Chrome/124 NeoFmApp/1.2.0 (android)")).toEqual({ platform: "android", version: "1.2.0" });
    expect(parseAppShell("Mozilla/5.0 (iPhone) AppleWebKit/605 NeoFmApp/1.0.0 (ios)")).toEqual({ platform: "ios", version: "1.0.0" });
  });
  it("is null for browsers, empty and missing user agents", () => {
    expect(parseAppShell("Mozilla/5.0 (iPhone) Safari/604")).toBeNull();
    expect(parseAppShell("")).toBeNull();
    expect(parseAppShell(null)).toBeNull();
  });
});
