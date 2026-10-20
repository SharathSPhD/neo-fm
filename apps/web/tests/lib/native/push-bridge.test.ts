import { describe, expect, it } from "vitest";

import { safeTapPath, startNativePush } from "../../../lib/native/push-bridge";

describe("push bridge", () => {
  it("only follows site-relative paths from a tapped notification", () => {
    expect(safeTapPath("/station?s=raat")).toBe("/station?s=raat");
    for (const bad of ["//evil.com", "https://evil.com", "javascript:alert(1)", "", 5, undefined]) expect(safeTapPath(bad)).toBeNull();
  });
  it("does nothing outside the Android app", async () => {
    expect(await startNativePush()).toBe(false);
  });
});

describe("registered flag", () => {
  it("is false when storage is unavailable", async () => {
    const { nativePushRegistered } = await import("../../../lib/native/push-bridge");
    expect(nativePushRegistered()).toBe(false);
  });
});
