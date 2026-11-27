import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PageDocSchema } from "@epaper/core";

/** The block Style control (newspaper finish): plain / boxed brief / pull quote / tinted panel, and the drop cap. Mock API, real browser. */
test.use({ viewport: { width: 1440, height: 900 } });
const API = `http://127.0.0.1:${process.env.E2E_API ?? 8181}`;
const SHOTS = "e2e-screens";

async function open(page: Page, user = "ana") {
  await page.addInitScript(([cfg]) => { (window as any).__EPAPER_CONFIG__ = cfg; }, [{ apiBase: API, mockUser: user, edition: "ed_demo", autosaveMs: 300, lockPollMs: 700, retryMs: 500 }]);
  await page.goto("/");
  await expect(page.getByTestId("fill-meter")).toContainText(/%/, { timeout: 15000 });
  await page.getByTestId("page-tab-2").click();
  await expect(page.locator(".page")).toHaveAttribute("data-page", "2");
  await expect(page.locator(".page .story").first()).toBeVisible();
}
const blk = (page: Page, id: string) => page.locator(`.page .story[data-item="${id}"]`);
const savedPage = async (request: APIRequestContext) => (await (await request.get(`${API}/v1/editions/ed_demo`)).json()).pages.find((p: any) => p.id === "pg_two").doc;
const settle = (page: Page) => expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10000 });
const pick = async (page: Page, id: string) => { await blk(page, id).locator(".head").click(); await expect(blk(page, id)).toHaveAttribute("aria-pressed", "true"); };

test.beforeEach(async ({ request }) => {
  await request.post(`${API}/__reset`);
  await request.post(`${API}/__config`, { data: { ai: false, cutout: false, lockTtlMs: 300000 } });
});

test("the Style control switches a block to boxed brief, pull quote, tinted panel and back; it is saved, valid and survives a reload", async ({ page, request }) => {
  await open(page);
  await expect(page.getByTestId("style-control")).toHaveCount(0); // nothing selected, no control
  await pick(page, "it_2x2");
  const ctl = page.getByTestId("style-control");
  await expect(ctl).toBeVisible();
  const sel = page.getByTestId("style-select");
  await expect(sel).toHaveValue("plain");
  const cls = { brief: "b-brief", quote: "b-quote", panel: "b-panel" } as const;
  for (const [value, c] of Object.entries(cls)) {
    await sel.selectOption(value);
    await expect(blk(page, "it_2x2")).toHaveClass(new RegExp(c));
    await settle(page);
    const doc = await savedPage(request);
    expect(PageDocSchema.safeParse(doc).success).toBe(true);
    expect(doc.items.find((i: any) => i.id === "it_2x2").block).toBe(value);
    await page.screenshot({ path: `${SHOTS}/finish-${value}.png` });
  }
  // after a reload the block is still a tinted panel (it came back from the saved page)
  await page.reload();
  await expect(page.locator(".page .story").first()).toBeVisible();
  await page.getByTestId("page-tab-2").click();
  await expect(blk(page, "it_2x2")).toHaveClass(/b-panel/);
  // and back to plain: the field is gone, the page is as it was
  await pick(page, "it_2x2");
  await page.getByTestId("style-select").selectOption("plain");
  await expect(blk(page, "it_2x2")).not.toHaveClass(/b-/);
  await settle(page);
  expect((await savedPage(request)).items.find((i: any) => i.id === "it_2x2").block).toBeUndefined();
});

test("the drop cap switch works on English text, the page refits, and the choice is saved; the version list keeps the styled page", async ({ page, request }) => {
  await open(page);
  await pick(page, "it_2x1");
  const toggle = page.getByTestId("dropcap-toggle");
  await expect(toggle).toBeEnabled();
  await expect(blk(page, "it_2x1").locator(".dc")).toHaveCount(0);
  await toggle.check();
  await expect(blk(page, "it_2x1")).toHaveClass(/ dc/);
  await expect(blk(page, "it_2x1").locator(".body .dc")).toHaveCount(1);
  await expect(page.getByTestId("fill-meter")).toContainText(/%/);
  await settle(page);
  expect((await savedPage(request)).items.find((i: any) => i.id === "it_2x1").dropcap).toBe(true);
  const vs = await (await request.get(`${API}/v1/pages/pg_two/versions`)).json();
  expect(JSON.stringify(vs.versions[0].doc)).toContain('"dropcap":true');
  // typing in the story after the drop cap keeps the text whole (the drop cap letter is part of the first word)
  await blk(page, "it_2x1").dblclick();
  await page.keyboard.press("Escape");
  const first = await blk(page, "it_2x1").locator(".body p").first().innerText();
  expect(first.length).toBeGreaterThan(20);
  await page.screenshot({ path: `${SHOTS}/finish-dropcap.png` });
  await toggle.uncheck();
  await expect(blk(page, "it_2x1")).not.toHaveClass(/ dc/);
});

test("a pull quote explains itself in plain words; a read-only viewer gets no Style control", async ({ page }) => {
  await open(page);
  await pick(page, "it_2x3");
  await page.getByTestId("style-select").selectOption("quote");
  await expect(page.getByTestId("style-control")).toContainText("prints the headline as the quote");
  await expect(page.getByTestId("dropcap-toggle")).toBeDisabled();
  const v = await page.context().newPage();
  await v.addInitScript(([cfg]) => { (window as any).__EPAPER_CONFIG__ = cfg; }, [{ apiBase: API, mockUser: "vic", edition: "ed_demo" }]);
  await v.goto("/");
  await expect(v.getByTestId("fill-meter")).toContainText(/%/, { timeout: 15000 });
  await v.getByTestId("page-tab-2").click();
  await blk(v, "it_2x1").locator(".head").click();
  await expect(v.getByTestId("style-control")).toHaveCount(0);
});
