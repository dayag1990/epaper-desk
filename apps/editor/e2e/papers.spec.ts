import { expect, test, type Page } from "@playwright/test";

const API = `http://127.0.0.1:${process.env.E2E_API ?? 8181}`;
test.use({ viewport: { width: 1440, height: 900 } });

/** Open the editor with ?edition= in the address (so a switch really drops it), as a given mock user. */
async function open(page: Page, user: string, edition: string | null = "ed_demo", extra: Record<string, unknown> = {}) {
  await page.addInitScript(([cfg]) => { (window as any).__EPAPER_CONFIG__ = cfg; }, [{ apiBase: API, mockUser: user, autosaveMs: 60_000, lockPollMs: 60_000, retryMs: 500, ...extra }]);
  await page.goto(edition ? `/?edition=${edition}` : "/");
}
const sw = (page: Page) => page.getByRole("combobox", { name: "Switch paper" });
const head = (page: Page, n = 0) => page.locator(".page .story .head").nth(n);
const ready = async (page: Page) => { await expect(page.getByTestId("fill-meter")).toContainText(/%/, { timeout: 15000 }); await expect(page.getByTestId("fill-meter")).not.toHaveText("Measuring…"); };

test.beforeEach(async ({ request }) => { await request.post(`${API}/__reset`); });

test("one paper: no switcher, but the Editions button is there", async ({ page }) => {
  await open(page, "ana");
  await ready(page);
  await expect(sw(page)).toHaveCount(0);
  await expect(page.getByTestId("editions-btn")).toBeVisible();
});

test("two papers: the switcher shows, and a switch returns to the new paper's edition list, never the old edition", async ({ page }) => {
  await open(page, "mia");
  await ready(page);
  await expect(page.locator(".title")).toHaveText("Riverton Herald · demo edition");
  await expect(sw(page)).toBeVisible();
  await expect(sw(page).locator("option")).toHaveText(["Riverton Herald (English)", "Thenpothigai (Tamil)"]);
  await expect(sw(page)).toHaveValue("riverton-herald");

  await sw(page).selectOption("thenpothigai");
  await expect(page.getByTestId("picker-paper")).toHaveText("Thenpothigai");
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator(".page .story")).toHaveCount(0); // nothing of the old edition
  await expect(page.getByTestId("edition-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("edition-list")).toContainText("Thenpothigai · demo edition");
  await expect(page.getByTestId("edition-list")).not.toContainText("Riverton");
  await expect(sw(page)).toHaveValue("thenpothigai");

  await page.getByRole("link", { name: "Open" }).click();
  await ready(page);
  await expect(page.locator(".title")).toHaveText("Thenpothigai · demo edition");
  await expect(head(page)).toContainText("தமிழ் ·");
  await expect(sw(page)).toHaveValue("thenpothigai");

  // and back; the Editions button leads to the list of the paper we are in
  await sw(page).selectOption("riverton-herald");
  await expect(page.getByTestId("picker-paper")).toHaveText("Riverton Herald");
  await expect(page.getByTestId("edition-list")).toContainText("Riverton Herald · demo edition");
});

test("an edition of the other paper is a plain 'not found' screen with no data", async ({ page }) => {
  await open(page, "mia");
  await ready(page);
  await sw(page).selectOption("thenpothigai");
  await expect(page.getByTestId("picker-paper")).toHaveText("Thenpothigai");
  await page.goto("/?edition=ed_demo"); // paper one's edition, typed in while signed in to paper two
  await expect(page.getByRole("alert")).toContainText("That edition was not found");
  await expect(page.locator(".page .story")).toHaveCount(0);
  await expect(page.getByText("Riverton Herald")).toHaveCount(0);
  await page.getByRole("link", { name: "Pick an edition" }).click();
  await expect(page.getByTestId("edition-list")).toContainText("Thenpothigai · demo edition");
});

test("unsaved changes: the switch warns first; Stay keeps everything; Save then go saves, and the old page lock is released", async ({ page, request }) => {
  await open(page, "mia");
  await ready(page);
  const lockOf = (user: string) => request.post(`${API}/v1/pages/pg_front/lock`, { headers: { "x-mock-user": user }, data: {} });
  expect((await lockOf("bea")).status()).toBe(423); // mia holds the front page
  await head(page).dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" EXTRA");
  await expect(page.getByTestId("save-state")).toHaveText("Not saved yet");

  await sw(page).selectOption("thenpothigai");
  const warn = page.getByTestId("leave-warning");
  await expect(warn).toBeVisible();
  await expect(warn).toContainText("not saved yet");
  await warn.getByRole("button", { name: "Stay here" }).click();
  await expect(warn).toHaveCount(0);
  await expect(sw(page)).toHaveValue("riverton-herald");
  await expect(head(page)).toContainText("EXTRA"); // still there, still in this edition
  await expect(page.locator(".title")).toHaveText("Riverton Herald · demo edition");
  expect((await lockOf("bea")).status()).toBe(423); // staying keeps the lock

  await sw(page).selectOption("thenpothigai");
  await warn.getByRole("button", { name: "Save, then go" }).click();
  await expect(page.getByTestId("picker-paper")).toHaveText("Thenpothigai");
  expect((await lockOf("bea")).status()).toBe(200); // the old paper's lock was released before the switch

  // the saved edit is on the server for paper one
  await sw(page).selectOption("riverton-herald");
  await expect(page.getByTestId("picker-paper")).toHaveText("Riverton Herald");
  await page.getByRole("link", { name: "Open" }).click();
  await ready(page);
  await expect(head(page)).toContainText("EXTRA");
});

test("unsaved changes: 'Leave without saving' goes without a browser box", async ({ page }) => {
  await open(page, "mia");
  await ready(page);
  await head(page).dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" LOST");
  await sw(page).selectOption("thenpothigai");
  await page.getByRole("button", { name: "Leave without saving" }).click();
  await expect(page.getByTestId("picker-paper")).toHaveText("Thenpothigai");
});

test("no warning when nothing is unsaved", async ({ page }) => {
  await open(page, "mia");
  await ready(page);
  await sw(page).selectOption("thenpothigai");
  await expect(page.getByTestId("picker-paper")).toHaveText("Thenpothigai");
});

test("keyboard: the switcher takes focus and arrow keys change the paper; Editions is reachable by Tab", async ({ page }) => {
  await open(page, "mia");
  await ready(page);
  await page.getByTestId("editions-btn").focus();
  await page.keyboard.press("Tab");
  await expect(sw(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("picker-paper")).toHaveText("Thenpothigai");
  await sw(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("picker-paper")).toHaveText("Riverton Herald");
});

test("phone width 390: the switcher fits and works, and so does the edition list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "mia");
  await ready(page);
  const box = (await sw(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await sw(page).selectOption("thenpothigai");
  await expect(page.getByTestId("picker-paper")).toHaveText("Thenpothigai");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Open" }).click();
  await ready(page);
  const b2 = (await sw(page).boundingBox())!;
  expect(b2.x + b2.width).toBeLessThanOrEqual(390);
});
