/**
 * Optional global setup for protected Vercel previews: when E2E_SHARE_TOKEN is set, visit the base URL with
 * `?_vercel_share=<token>` once and persist the resulting cookie as storageState for every spec.
 */
import { chromium, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const token = process.env.E2E_SHARE_TOKEN;
  if (!token) return;
  const base = config.projects[0]?.use.baseURL ?? process.env.E2E_BASE_URL;
  if (!base) throw new Error("E2E_BASE_URL required with E2E_SHARE_TOKEN");
  const proxy = process.env.HTTPS_PROXY;
  const browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined, executablePath: process.env.E2E_CHROMIUM });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/?_vercel_share=${token}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await ctx.storageState({ path: "tests/e2e/.share-state.json" });
  await browser.close();
}
