import { describe, expect, it } from "vitest";

import { hasTelegramLaunchParams } from "../lib/telegram/mini-app";

describe("telegram mini app detection", () => {
  it("recognises Telegram's launch hash", () => {
    expect(hasTelegramLaunchParams("#tgWebAppData=query_id%3DAA&tgWebAppVersion=8.0")).toBe(true);
    expect(hasTelegramLaunchParams("#tgWebAppVersion=7.10&tgWebAppPlatform=ios")).toBe(true);
  });
  it("ignores ordinary pages and hashes", () => {
    for (const h of ["", "#", "#top", "#section-2", "?tgWebAppData=x"]) expect(hasTelegramLaunchParams(h)).toBe(false);
  });
});
