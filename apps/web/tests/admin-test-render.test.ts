import { describe, expect, it } from "vitest";

import { renderCap, validateItems } from "../lib/admin/test-render";

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

describe("test-render eval_batch", () => {
  it("accepts a short alphanumeric batch and rejects anything else", () => {
    expect(validateItems({ items: [{ label: "a", language: "hi", brief_id: "hi-1", eval_batch: "fullC" }] }, 3).ok).toBe(true);
    expect(validateItems({ items: [{ label: "a", language: "hi", brief_id: "hi-1", eval_batch: "full C;" }] }, 3).ok).toBe(false);
  });
});

describe("test-render target_seconds", () => {
  it("accepts 30 to 180 seconds and rejects the rest", () => {
    const one = (target_seconds: number) => validateItems({ items: [{ label: "a", language: "hi", lyrics: "x", target_seconds }] }, 3).ok;
    expect(one(150)).toBe(true);
    expect(one(20)).toBe(false);
    expect(one(300)).toBe(false);
  });
});

describe("test-render clip", () => {
  const item = { label: "hi-clip", language: "hi", lyrics: "x" };

  it("accepts a boolean clip flag and rejects anything else", () => {
    expect(validateItems({ items: [{ ...item, clip: true }] }, 3).ok).toBe(true);
    expect(validateItems({ items: [{ ...item, clip: "yes" }] }, 3).ok).toBe(false);
  });
});
