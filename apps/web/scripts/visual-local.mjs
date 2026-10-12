/**
 * Visual-regression runner: same build + fake backend as the smoke suite, with
 * the visual Playwright config. Pass `--update-snapshots=all` to rewrite baselines.
 */
process.env.PW_CONFIG = "playwright.visual.config.ts";
await import("./smoke-local.mjs");
