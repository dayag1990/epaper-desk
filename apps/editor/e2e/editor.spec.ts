import { expect, test, type Page, type BrowserContext } from "@playwright/test";

const API = "http://127.0.0.1:8181";

async function open(page: Page, user = "ana", extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([cfg]) => { (window as any).__EPAPER_CONFIG__ = cfg; },
    [{ apiBase: "http://127.0.0.1:8181", mockUser: user, edition: "ed_demo", autosaveMs: 300, lockPollMs: 700, retryMs: 500, ...extra }],
  );
  await page.goto("/");
  await expect(page.getByTestId("fill-meter")).toContainText(/%/, { timeout: 15000 });
  await expect(page.getByTestId("fill-meter")).not.toHaveText("Measuring…");
}
const pct = async (page: Page) => +((await page.getByTestId("fill-meter").innerText()).match(/(\d+)% full|Overflow \+(\d+)%/) ?.slice(1).find(Boolean) ?? NaN);
const meterText = (page: Page) => page.getByTestId("fill-meter").innerText();
const head = (page: Page, n = 0) => page.locator(".page .story .head").nth(n);

test.beforeEach(async ({ request }) => {
  await request.post(`${API}/__reset`);
  await request.post(`${API}/__config`, { data: { ai: false, cutout: false, lockTtlMs: 300000 } });
});

test("edit a headline: the page refits and the fill % changes", async ({ page }) => {
  await open(page);
  await page.getByTestId("page-tab-2").click();
  await expect(head(page)).toBeVisible();
  await expect(page.getByTestId("fill-meter")).toContainText("text");
  const before = await meterText(page);
  const p0 = await pct(page);
  await head(page).dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" and then a very long extra stretch of headline words that wraps onto many lines of the narrow column and pushes the story down the page for sure ".repeat(3));
  await expect.poll(() => meterText(page), { timeout: 10000 }).not.toBe(before);
  expect(await pct(page)).toBeGreaterThan(p0);
});

test("save, reload: the edit is still there", async ({ page }) => {
  await open(page);
  await head(page).dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" REALLYSAVED");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10000 });
  await page.reload();
  await expect(page.getByTestId("fill-meter")).toContainText("text", { timeout: 15000 });
  await expect(head(page)).toContainText("REALLYSAVED");
});

test("a tool changes the page and survives a reload", async ({ page }) => {
  await open(page);
  await page.getByTestId("page-tab-2").click();
  await head(page).dblclick();
  const w = async () => page.locator(".page .story").first().getAttribute("data-span");
  const w0 = +(await w())!;
  await page.getByTestId("tool-span-").click();
  expect(+(await w())!).toBe(w0 - 1);
  await page.getByTestId("tool-hs+").click();
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10000 });
  await page.reload();
  await expect(page.getByTestId("fill-meter")).toContainText("text", { timeout: 15000 });
  await page.getByTestId("page-tab-2").click();
  await expect(page.locator(".page .story").first()).toHaveAttribute("data-hs", "1.1");
  await expect(page.locator(".page .story").first()).toHaveAttribute("data-span", String(w0 - 1));
});

test("second user sees who holds the lock and cannot edit", async ({ browser }) => {
  const a = await browser.newContext(); const b = await browser.newContext();
  const pa = await a.newPage(), pb = await b.newPage();
  await open(pa, "ana");
  await expect(pa.getByTestId("lock-banner")).toHaveCount(0);
  await head(pa).dblclick();
  await expect(pa.locator(".page [contenteditable=true]").first()).toBeVisible();
  await open(pb, "bea");
  await expect(pb.getByTestId("lock-banner")).toContainText("Ana Costa");
  await expect(pb.locator(".page [contenteditable=true]")).toHaveCount(0);
  await expect(pb.getByTestId("mode")).toHaveCount(0);
  await a.close(); await b.close();
});

test("a viewer cannot save", async ({ page, request }) => {
  await open(page, "vic");
  await expect(page.getByTestId("lock-banner")).toContainText("read this edition but not change or save");
  await expect(page.locator(".page [contenteditable=true]")).toHaveCount(0);
  await expect(page.getByTestId("save-now")).toHaveCount(0);
  const doc = await (await request.get(`${API}/v1/editions/ed_demo`, { headers: { "x-mock-user": "vic" } })).json();
  const p = doc.pages[0];
  const r = await request.put(`${API}/v1/pages/${p.id}`, { headers: { "x-mock-user": "vic" }, data: { doc: p.doc, rev: p.rev } });
  expect(r.status()).toBe(403);
});

test("AI button only exists when the API says AI is on", async ({ page, request }) => {
  await open(page);
  await expect(page.getByTestId("ai-btn")).toHaveCount(0);
  await request.post(`${API}/__config`, { data: { ai: true } });
  await page.reload();
  await expect(page.getByTestId("fill-meter")).toContainText("text", { timeout: 15000 });
  await expect(page.getByTestId("ai-btn")).toBeVisible();
});

test("API down mid-edit: typing is kept and saved when it returns", async ({ page, request }) => {
  await open(page);
  await page.route("**/v1/pages/pg_front", (r) => (r.request().method() === "PUT" ? r.abort() : r.continue()));
  await head(page).dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" TYPEDOFFLINE");
  await expect(page.getByTestId("save-state")).toContainText("Offline", { timeout: 10000 });
  await page.unroute("**/v1/pages/pg_front");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10000 });
  const ed = await (await request.get(`${API}/v1/editions/ed_demo`)).json();
  expect(JSON.stringify(ed.pages[0].doc)).toContain("TYPEDOFFLINE");
});

test("versions: restore brings back earlier text", async ({ page }) => {
  await open(page);
  const original = await head(page).innerText();
  await head(page).dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" CHANGEDTEXT");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10000 });
  await page.getByTestId("versions-btn").click();
  await expect(page.getByTestId("version-list").locator("li")).toHaveCount(2);
  const r1 = page.getByTestId("restore-1");
  await r1.click(); await r1.click();
  await expect(head(page)).toHaveText(original, { timeout: 10000 });
});

test("photo: swap and set the focal point; cut-out falls back to manual crop when not built", async ({ page }) => {
  await open(page);
  await head(page).dblclick();
  await page.getByTestId("tool-img").click();
  await page.getByTestId("swap-photo").click();
  await page.getByTestId("file-input").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgo=", "base64") });
  await expect(page.locator(".page .story").first().locator("img")).toHaveAttribute("src", /ast_up1/, { timeout: 10000 });
  await page.getByTestId("focal-picker").click({ position: { x: 20, y: 10 } });
  await expect(page.locator(".page .story").first().locator("img")).toHaveAttribute("style", /object-position:\s*[0-9.]+%\s+[0-9.]+%/);
  await page.getByTestId("cutout").click();
  await expect(page.getByTestId("toast")).toContainText("Crop it by hand");
});

test("phone width: reads, and the toolbar is reachable", async ({ browser }) => {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392);
  await page.getByTestId("mode").tap();
  await head(page).tap();
  const tb = page.getByTestId("toolbar");
  await expect(tb).toBeVisible();
  const box = await page.getByTestId("tool-hs+").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  await page.getByTestId("tool-hs+").scrollIntoViewIfNeeded();
  await page.getByTestId("tool-hs+").tap();
  await expect(page.locator(".page .story").first()).toHaveAttribute("data-hs", "1.1");
  await ctx.close();
});
