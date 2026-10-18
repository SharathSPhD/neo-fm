import { expect, test } from "@playwright/test";

// Server-rendered language selection: cookie wins, then Accept-Language, then English.
test.describe("ui language", () => {
  test("defaults from Accept-Language", async ({ request }) => {
    const res = await request.get("/pricing", { headers: { "Accept-Language": "ta-IN,ta;q=0.9,en;q=0.5" } });
    const html = await res.text();
    expect(html).toContain('<html lang="ta"');
    expect(html).toContain("உங்கள் கதைகளைப் பாடுங்கள்");
  });

  test("cookie overrides the browser language", async ({ request }) => {
    const res = await request.get("/pricing", { headers: { "Accept-Language": "ta", Cookie: "neo-fm-lang=bn" } });
    expect(await res.text()).toContain('<html lang="bn"');
  });

  test("switcher persists the choice and re-renders", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByLabel(/language/i).first().selectOption("hi");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  });
});
