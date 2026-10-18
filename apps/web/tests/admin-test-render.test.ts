import { describe, expect, it } from "vitest";

import { renderCap, validateItems } from "../app/api/admin/test-render/route";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("test-render guards", () => {
  it("caps renders per call at TEST_RENDER_MAX, never above 5", () => {
    expect(renderCap(env({}))).toBe(3);
    expect(renderCap(env({ TEST_RENDER_MAX: "2" }))).toBe(2);
    expect(renderCap(env({ TEST_RENDER_MAX: "99" }))).toBe(5);
    expect(renderCap(env({ TEST_RENDER_MAX: "abc" }))).toBe(3);
  });

  const item = { label: "hi-diwali", language: "hi", lyrics: "x" };

  it("rejects more items than the cap", () => {
    expect(validateItems({ items: [item, item, item, item] }, 3).ok).toBe(false);
    expect(validateItems({ items: [item, item, item] }, 3).ok).toBe(true);
  });

  it("rejects missing items, bad labels and items without lyrics", () => {
    expect(validateItems({}, 3).ok).toBe(false);
    expect(validateItems({ items: [] }, 3).ok).toBe(false);
    expect(validateItems({ items: [{ ...item, label: "../x" }] }, 3).ok).toBe(false);
    expect(validateItems({ items: [{ label: "a", language: "hi" }] }, 3).ok).toBe(false);
  });
});
