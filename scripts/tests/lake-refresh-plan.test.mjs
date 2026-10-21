// node --test scripts/tests/lake-refresh-plan.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { fillCost, fillCommand, gridCells, pickCells, planRefresh, renderMarkdown } from "../lake-refresh-plan.mjs";

const track = (id, verdict, flags = []) => ({ id, title: id, verdict, flags, score: 50 });
const lang = (tracks, cells) => ({ total: tracks.length, tracks, cells });

test("fillCost sizes renders by the admit rate and the cap leaves 10 percent headroom", () => {
  const c = fillCost(10);
  assert.equal(c.renders, 12);
  assert.equal(c.gbp, 3.36);
  assert.equal(c.maxGbp, 4);
});

test("gridCells counts missing energies as empty and sorts thinnest first", () => {
  const cells = gridCells(lang([], [{ genre: "folk", energy: "mid", tracks: 5 }, { genre: "untagged", energy: "mid", tracks: 9 }]));
  assert.deepEqual(cells.map((c) => `${c.energy}:${c.tracks}`), ["low:0", "high:0", "mid:5"]);
  assert.ok(!cells.some((c) => c.genre === "untagged"));
});

test("pickCells keeps topping up the thinnest cell", () => {
  const picked = pickCells([{ genre: "a", energy: "low", tracks: 0 }, { genre: "a", energy: "mid", tracks: 2 }], 4);
  assert.deepEqual(picked.map((p) => p.energy), ["low", "low", "low", "mid"]);
});

test("planRefresh replaces flagged tracks and adds to reach the target, capped", () => {
  const tracks = [track("t1", "keep"), track("t2", "replace", ["reported"]), track("t3", "watch", ["low-diction"]), track("t4", "keep")];
  const report = { languages: { kn: lang(tracks, [{ genre: "film-pop", energy: "mid", tracks: 4 }]) } };
  const [p] = planRefresh(report, { targets: { kn: 10 }, maxPerLang: 5, stamp: "20261021" });
  assert.equal(p.replace.length, 1);
  assert.equal(p.watch, 1);
  assert.equal(p.add, 5);
  assert.equal(p.capped, true);
  assert.equal(p.briefs.length, 5);
  assert.equal(p.briefs[0].code, "kn");
  assert.equal(p.briefs[0].language, "Kannada");
  assert.match(p.briefs[0].id, /^r20261021-/);
  assert.ok(p.briefs.every((b) => b.style === "film-pop" && ["low", "mid", "high"].includes(b.energy)));
});

test("a language at target with nothing to replace gets no fill", () => {
  const report = { languages: { hi: lang([track("a", "keep"), track("b", "keep")], [{ genre: "pop", energy: "mid", tracks: 2 }]) } };
  const [p] = planRefresh(report, { targets: { hi: 2 } });
  assert.equal(p.add, 0);
  assert.equal(p.cost, null);
  assert.ok(!renderMarkdown([p], { dir: "x" }).includes("lake-fill.mjs"));
});

test("a replacement alone triggers a one-track fill and the command carries the cap", () => {
  const report = { languages: { kn: lang([track("a", "keep"), track("b", "replace", ["too-short"])], [{ genre: "pop", energy: "mid", tracks: 2 }]) } };
  const [p] = planRefresh(report, { targets: { kn: 2 } });
  assert.equal(p.add, 1);
  assert.match(fillCommand(p, "b.json", "o"), /--briefs b\.json --out o\/fill-kn --max-gbp 1$/);
});
