import { expect, test, type Page } from "@playwright/test";

const MOCK = "http://127.0.0.1:8171";
const ADMIN = "/admin/";

test.beforeEach(async ({ request }) => { await request.get(`${MOCK}/__reset`); });
test.use({ viewport: { width: 1440, height: 900 } });

async function login(page: Page, who: string) {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(`${who}@desk.test`);
  await page.getByLabel("Password").fill(`${who}-pass-123`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("role")).toBeVisible();
}
const switcher = (page: Page) => page.getByRole("combobox", { name: "Switch paper" });

test("the switcher is hidden when the person belongs to one paper", async ({ page }) => {
  await login(page, "owner");
  await expect(page.getByTestId("paper-name")).toHaveText("Daily Demo");
  await expect(switcher(page)).toHaveCount(0);
});

test("two papers: the switcher shows name and language, and switching changes every list", async ({ page }) => {
  await login(page, "multi");
  await expect(switcher(page)).toBeVisible();
  await expect(switcher(page).locator("option")).toHaveText(["Daily Demo (English)", "Thenpothigai (Tamil)"]);
  await expect(page.getByTestId("role")).toHaveText("owner");
  await page.getByRole("link", { name: "Articles" }).click();
  await expect(page.getByTestId("article")).toHaveCount(3);
  await expect(page.getByTestId("article").first()).toContainText("Floods hit the coast");

  // make an edition in paper one, to prove it cannot be seen from paper two
  await page.getByRole("link", { name: "Editions" }).click();
  await page.getByRole("button", { name: "Create edition" }).click();
  await expect(page.getByTestId("edition-detail")).toBeVisible();
  expect((await page.request.get("/v1/admin/editions/e1/overview")).status()).toBe(200);

  await switcher(page).selectOption("thenpothigai");
  await expect(page.getByTestId("paper-name")).toHaveText("Thenpothigai");
  await expect(page.getByTestId("role")).toHaveText("editor"); // a different role in this paper
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByTestId("edition-row")).toHaveCount(0);
  await expect(page.getByTestId("edition-detail")).toHaveCount(0);
  // an edition id of the other paper is plain 'not found', never data
  const r = await page.request.get("/v1/admin/editions/e1/overview");
  expect(r.status()).toBe(404);
  expect((await r.json()).message).toBe("That edition was not found.");
  await page.getByRole("link", { name: "Articles" }).click();
  await expect(page.getByTestId("article")).toHaveCount(2);
  await expect(page.getByTestId("article").first()).toContainText("கடலோரத்தில் வெள்ளம்");
  await expect(page.getByText("Floods hit the coast")).toHaveCount(0);

  // and back; the choice survives a reload (the session moved, not just the screen)
  await switcher(page).selectOption("daily-demo");
  await expect(page.getByTestId("paper-name")).toHaveText("Daily Demo");
  await expect(page.getByTestId("article")).toHaveCount(3);
  await switcher(page).selectOption("thenpothigai");
  await expect(page.getByTestId("paper-name")).toHaveText("Thenpothigai");
  await page.reload();
  await expect(page.getByTestId("paper-name")).toHaveText("Thenpothigai");
  await expect(switcher(page)).toHaveValue("thenpothigai");
});

test("a paper you do not belong to is refused in plain words", async ({ page }) => {
  await login(page, "multi");
  const r = await page.request.post("/v1/auth/switch", { data: { paper: "nope" } });
  expect(r.status()).toBe(403);
  expect((await r.json()).message).toBe("You do not have access to that paper.");
});

test("keyboard: tab to the switcher, arrow to the other paper", async ({ page }) => {
  await login(page, "multi");
  await switcher(page).focus();
  await expect(switcher(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("paper-name")).toHaveText("Thenpothigai");
  await expect(switcher(page)).toHaveValue("thenpothigai");
  await switcher(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("paper-name")).toHaveText("Daily Demo");
});

test("phone width 390: the switcher fits and works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "multi");
  const box = (await switcher(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await switcher(page).selectOption("thenpothigai");
  await expect(page.getByTestId("paper-name")).toHaveText("Thenpothigai");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
