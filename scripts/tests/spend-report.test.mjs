import test from "node:test";
import assert from "node:assert/strict";
import { BUDGET_USD, SPLIT_USD, collect, renderMarkdown, sumCostUsd, projection, weeklyCaps, unitCosts } from "../spend-report.mjs";

const now = new Date("2026-10-20T00:00:00Z");
const since = new Date("2026-10-10T00:00:00Z");

test("cost amounts are cents and sum by day and model", () => {
  const c = sumCostUsd([
    { starting_at: "2026-10-18T00:00:00Z", results: [{ amount: "250.5", model: "a" }, { amount: "49.5", model: "b" }] },
    { starting_at: "2026-10-19T00:00:00Z", results: [{ amount: "100", model: "a" }] },
  ]);
  assert.equal(c.total, 4);
  assert.equal(c.byModel.get("a"), 3.505);
});

test("projection flags over-budget burn", () => {
  const p = projection(40, since, now);
  assert.ok(p.projected > 88);
});

test("without admin key the report says billed spend is unavailable and never calls the API", async () => {
  let called = 0;
  const r = await collect({ env: {}, fetchImpl: () => { called++; }, now, since });
  assert.equal(called, 0);
  assert.match(renderMarkdown(r), /not available/);
});

test("with a key it pages cost_report and sends the key only as a header", async () => {
  const urls = [];
  const fetchImpl = async (url, { headers }) => {
    urls.push(url);
    assert.equal(headers["x-api-key"], "k");
    assert.ok(!url.includes("k&") && !url.includes("=k"));
    const page = url.includes("page=p2");
    return { ok: true, json: async () => url.includes("cost_report")
      ? { data: [{ starting_at: "2026-10-18T00:00:00Z", results: [{ amount: page ? "100" : "200", model: "m" }] }], has_more: !page, next_page: "p2" }
      : { data: [], has_more: false } };
  };
  const r = await collect({ env: { MA_ADMIN_KEY: "k" }, fetchImpl, now, since });
  assert.equal(r.cost.total, 3);
  assert.match(renderMarkdown(r), /USD 3\.00/);
});

test("budget split sums to the budget", () => {
  assert.equal(Object.values(SPLIT_USD).reduce((a, b) => a + b, 0), BUDGET_USD);
});

test("weekly caps spread each allocation over the weeks left and sum to the budget", () => {
  const { weeks, caps } = weeklyCaps(SPLIT_USD, new Date("2026-10-18T00:00:00Z"), new Date("2026-11-05T00:00:00Z"));
  assert.ok(Math.abs(weeks - 18 / 7) < 1e-9);
  assert.ok(Math.abs(Object.values(caps).reduce((a, b) => a + b, 0) * weeks - BUDGET_USD) < 1e-9);
});

test("unit cost converts Lyria GBP and guards divide by zero", () => {
  const u = unitCosts({ claudeUsd: 10, lyriaGbp: 5, gbpUsd: 2, tracks: 10, listenerHours: 0 });
  assert.equal(u.total, 20);
  assert.equal(u.perTrack, 2);
  assert.equal(u.perListenerHour, null);
});

test("report shows weekly caps and unit cost when given counts", async () => {
  const fetchImpl = async (url) => ({ ok: true, json: async () => (url.includes("cost_report")
    ? { data: [{ starting_at: "2026-10-18T00:00:00Z", results: [{ amount: "1000", model: "m" }] }], has_more: false } : { data: [], has_more: false }) });
  const r = await collect({ env: { MA_ADMIN_KEY: "k" }, fetchImpl, now, since });
  const md = renderMarkdown({ ...r, tracks: 5, listenerHours: 20, bucketSpend: { prod: 3 } });
  assert.match(md, /Weekly cap/);
  assert.match(md, /Per track: USD 2\.00 over 5 tracks/);
  assert.match(md, /Per listener-hour: USD 0\.50/);
});
