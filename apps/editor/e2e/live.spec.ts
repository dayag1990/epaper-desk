import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8181";

async function open(page: Page, user = "ana", extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([cfg]) => { (window as any).__EPAPER_CONFIG__ = cfg; },
    [{ apiBase: API, mockUser: user, edition: "ed_demo", autosaveMs: 300, lockPollMs: 700, retryMs: 500, ...extra }],
  );
  await page.goto("/");
  await expect(page.getByTestId("fill-meter")).toContainText(/%/, { timeout: 15000 });
  await expect(page.getByTestId("fill-meter")).not.toHaveText("Measuring…");
}
const head = (page: Page, n = 0) => page.locator(".page .story .head").nth(n);
const other = (request: any, page_id: string, headline: string, fill: number) => request.post(`${API}/__other_saves`, { data: { page: page_id, headline, fill } });

test.beforeEach(async ({ request }) => {
  await request.post(`${API}/__reset`);
  await request.post(`${API}/__config`, { data: { ai: false, cutout: false, lockTtlMs: 300000, sse: true } });
});

test("live: another person saves a page and its tab fill % and the open page change with no reload", async ({ page, request }) => {
  await open(page);
  const tab2 = page.getByTestId("page-tab-2");
  await expect(page.getByTestId("fill-meter")).toBeVisible();
  await other(request, "pg_two", "Their new headline for page two", 97);
  await expect(tab2).toHaveAttribute("data-pct", "97", { timeout: 5000 });
  await expect(tab2).toContainText("97%");
  // the open page: replaced quietly because nobody here had touched it
  await other(request, "pg_front", "FRESH FROM BEA", 91);
  await expect(head(page)).toContainText("FRESH FROM BEA", { timeout: 5000 });
  await expect(page.getByTestId("remote-banner")).toHaveCount(0);
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
});

test("live: the worker's measure (page.fit) moves the tab colour and fill without touching the page", async ({ page, request }) => {
  await open(page);
  await request.post(`${API}/__emit`, { data: { type: "page.fit", page_id: "pg_three", edition_id: "ed_demo", rev: 2, fill: 108, state: "over", overflow: true } });
  const tab3 = page.getByTestId("page-tab-3");
  await expect(tab3).toHaveAttribute("data-pct", "108", { timeout: 5000 });
  await expect(tab3).toHaveClass(/over/);
});

test("live: if the person has unsaved changes on that page, nothing is overwritten; a plain notice with a Reload button, and both versions are kept", async ({ page, request }) => {
  await open(page, "ana", { autosaveMs: 600000 });
  await head(page).dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" MY OWN WORDS");
  await expect(page.getByTestId("save-state")).toHaveText("Not saved yet");
  await other(request, "pg_front", "THEIR HEADLINE", 90);
  const banner = page.getByTestId("remote-banner");
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText("Someone changed this page");
  await expect(head(page)).toContainText("MY OWN WORDS"); // still mine
  await expect(head(page)).not.toContainText("THEIR HEADLINE");
  await page.getByTestId("remote-reload").click();
  const modal = page.getByTestId("conflict");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("THEIR HEADLINE");
  await expect(modal).toContainText("MY OWN WORDS");
  await modal.getByRole("button", { name: "Take theirs" }).click();
  await expect(head(page)).toContainText("THEIR HEADLINE");
  await expect(banner).toHaveCount(0);
});

test("live: when the stream is blocked the page checks every 15 s instead (here 600 ms) and says so", async ({ page, request }) => {
  await request.post(`${API}/__config`, { data: { sse: false } });
  await open(page, "ana", { livePollMs: 600 });
  await expect(page.getByTestId("live-down")).toBeVisible({ timeout: 8000 });
  await other(request, "pg_two", "Found by the check", 95);
  await expect(page.getByTestId("page-tab-2")).toHaveAttribute("data-pct", "95", { timeout: 6000 });
});

test("top bar: links between the apps, the ops desk link and the alert bell only for owners", async ({ page }) => {
  await open(page, "ana");
  const bar = page.getByTestId("topbar");
  await expect(bar.getByRole("link", { name: "Editor", exact: true })).toHaveAttribute("aria-current", "page");
  for (const n of ["Admin", "Reader"]) await expect(bar.getByRole("link", { name: n, exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Ops desk" })).toHaveCount(0);
  await expect(page.getByTestId("bell")).toHaveCount(0);
  await expect(page.getByTestId("who")).toHaveText("Ana Costa");
});

test("alerts: an owner gets one toast and one bell count for an alert sent twice; dismiss works; the link opens the ops desk", async ({ page, request }) => {
  await open(page, "olga", { opsUrl: API });
  const bar = page.getByTestId("topbar");
  await expect(bar.getByRole("link", { name: "Ops desk" })).toBeVisible();
  await expect(page.getByTestId("bell")).toBeVisible();
  await expect(page.getByTestId("bell-count")).toHaveCount(0);
  await page.waitForTimeout(500); // the stream is open
  await request.post(`${API}/__alert`, { data: { id: "worker@1:fired", title: "The worker needs you", text: "The worker has been red for 2 minutes. Open the ops desk and press the fix button." } });
  const toast = page.getByTestId("alert-toast");
  await expect(toast).toHaveCount(1, { timeout: 5000 });
  await expect(toast).toContainText("The worker needs you");
  await expect(page.getByTestId("bell-count")).toHaveText("1");
  await expect(toast.getByRole("link", { name: "Open in ops desk" })).toHaveAttribute("href", "http://127.0.0.1:8181/");
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("alert-toast")).toHaveCount(0);
  await page.getByTestId("bell").click();
  await expect(page.getByTestId("bell-menu")).toContainText("The worker needs you");
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByTestId("bell-count")).toHaveCount(0);
});

test("sign out: asks the server to sign out (which clears the shared cookie) and leaves for the admin sign-in page", async ({ page }) => {
  let called = false;
  await page.route("**/v1/auth/logout", async (r) => { called = true; await r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await page.addInitScript(() => { (window as any).__EPAPER_LINKS__ = { admin: "http://127.0.0.1:8180/__admin_login__" }; });
  await open(page, "ana");
  await page.route("**/__admin_login__", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>sign in</title>sign in page" }));
  await page.getByTestId("sign-out").click();
  await page.waitForURL("**/__admin_login__");
  expect(called).toBe(true);
});

test("motion: a refit glides the blocks; not while typing; not when the person asked for less motion", async ({ page, browser }) => {
  await open(page);
  await page.getByTestId("page-tab-2").click();
  await head(page).click();
  const stage = page.getByTestId("stage");
  await expect(stage).not.toHaveAttribute("data-glide", /.+/);
  await page.getByTestId("tool-span-").click();
  await expect(stage).toHaveAttribute("data-glide", /\d+/, { timeout: 5000 });
  // typing: no glide (the count of glides does not grow)
  await page.waitForTimeout(1200); // let the refit and the save of the width change settle
  const runs = async () => Number((await stage.getAttribute("data-glide")) ?? 0);
  const before = await runs();
  await head(page).dblclick();
  
  await page.keyboard.type(" typing right now keeps the blocks still ");
  await page.waitForTimeout(500);
  expect(await runs()).toBe(before);
  // reduced motion
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const p2 = await ctx.newPage();
  await open(p2);
  await p2.getByTestId("page-tab-2").click();
  await head(p2).click();
  await p2.getByTestId("tool-span-").click();
  await p2.waitForTimeout(600);
  await expect(p2.getByTestId("stage")).not.toHaveAttribute("data-glide", /.+/);
  await ctx.close();
});
