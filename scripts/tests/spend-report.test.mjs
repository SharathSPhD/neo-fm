import test from "node:test";
import assert from "node:assert/strict";
import { collect, renderMarkdown, sumCostUsd, projection } from "../spend-report.mjs";

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
