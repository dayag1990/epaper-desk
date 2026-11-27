import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(resolve(here, "../../../fixtures/english-15.json"), "utf8"));
const byId = new Map<string, { url: string; headline: string }>(fx.articles.map((a: any) => [a.id, a]));
const BASE = "http://127.0.0.1:8185";

async function sheetBox(page: Page) {
  const b = await page.locator(".sheet").boundingBox();
  if (!b) throw new Error("no sheet");
  return b;
}
async function swipe(page: Page, dir: -1 | 1) {
  const m = page.mouse;
  const y = 300, from = dir > 0 ? 330 : 70, to = dir > 0 ? 60 : 340;
  await m.move(from, y); await m.down(); await m.move((from + to) / 2, y, { steps: 4 }); await m.move(to, y, { steps: 4 }); await m.up();
}
async function latest(page: Page) {
  const l = await (await page.request.get(`${BASE}/ed/latest.json`)).json();
  return l as { sha: string; pages: number };
}
async function zonesOf(page: Page, n: number) {
  const { sha } = await latest(page);
  return (await (await page.request.get(`${BASE}/ed/${sha}/pages/${String(n).padStart(4, "0")}/zones.json`)).json()) as { zones: { id: string; article_id: string | null; title: string; url: string | null; rects: number[][] }[] };
}

test("open, swipe to page 3, tap a story zone: the site's own article opens", async ({ page, context }) => {
  // the publisher's site is not running here: answer for it so the popup URL is observable
  await context.route("http://127.0.0.1:8190/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>article</title>" }));
  await page.goto("/#/latest/1");
  await expect(page.getByTestId("pageno")).toHaveText("Page 1 / 24");
  await expect(page.locator(".sheet img.base")).toBeVisible();
  await swipe(page, 1);
  await expect(page.getByTestId("pageno")).toHaveText("Page 2 / 24");
  await swipe(page, 1);
  await expect(page.getByTestId("pageno")).toHaveText("Page 3 / 24");
  await expect(page.getByTestId("strip").locator("[aria-current=true]")).toHaveAttribute("aria-label", "Page 3");

  // wait until the zones for page 3 are on screen
  const zs = (await zonesOf(page, 3)).zones.filter((z) => z.article_id && byId.has(z.article_id));
  expect(zs.length).toBeGreaterThan(0);
  await expect(page.locator(".zone").first()).toBeAttached();
  for (const z of zs.slice(0, 3)) {
    const box = await sheetBox(page);
    const [x, y, w, h] = z.rects[0];
    const popup = context.waitForEvent("page");
    await page.mouse.click(box.x + (x + w / 2) * box.width, box.y + (y + h / 2) * box.height);
    await expect(page.locator(`.zone.hot[data-zone="${z.id}"]`).first()).toBeAttached();
    const p = await popup;
    await p.waitForLoadState();
    expect(p.url()).toBe(byId.get(z.article_id!)!.url);
    await p.close();
  }
});

test("double tap zooms through the image levels", async ({ page }) => {
  await page.goto("/#/latest/1");
  const stage = page.getByTestId("stage");
  await expect(stage).toHaveAttribute("data-level", "400");
  const box = (await stage.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + 150;
  await page.mouse.click(cx, cy, { clickCount: 2, delay: 30 });
  await expect(stage).toHaveAttribute("data-level", "1600");
  await page.mouse.click(cx, cy, { clickCount: 2, delay: 30 });
  await expect(stage).toHaveAttribute("data-level", "3200");
  await expect(page.locator(".sheet img.hi")).toHaveAttribute("src", /w3200\.webp/);
});

test("search finds a headline and jumps to its page", async ({ page }) => {
  await page.goto("/#/latest/1");
  await page.getByRole("button", { name: "Search" }).click();
  // pick a headline whose zone sits on a page after 1, from the real zones
  const { pages } = await latest(page);
  let target: { title: string; no: number } | null = null;
  for (let n = 2; n <= pages && !target; n++) {
    const z = (await zonesOf(page, n)).zones.find((q) => q.article_id && byId.has(q.article_id));
    if (z) target = { title: byId.get(z.article_id!)!.headline, no: n };
  }
  expect(target).not.toBeNull();
  await page.getByPlaceholder("Search this edition").fill(target!.title.slice(0, 24));
  const hit = page.getByTestId("hits").locator("button").first();
  await expect(hit).toContainText(`p.${target!.no}`);
  await hit.click();
  await expect(page.getByTestId("pageno")).toHaveText(`Page ${target!.no} / 24`);
});

test("reload in airplane mode still shows the edition", async ({ page, context }) => {
  await page.goto("/#/latest/2");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => 0));
  await page.reload();
  await expect(page.getByTestId("pageno")).toHaveText("Page 2 / 24");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("pageno")).toHaveText("Page 2 / 24");
  const ok = await page.locator(".sheet img.base").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);
  expect(ok).toBe(true);
  await swipe(page, 1);
  await expect(page.getByTestId("pageno")).toHaveText("Page 3 / 24");
  await expect.poll(() => page.locator(".sheet img.base").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await context.setOffline(false);
});

test("embed.js on a plain page shows the cover and opens the reader", async ({ page, context }) => {
  await page.goto("http://127.0.0.1:8186/embed-test.html");
  const frame = page.frameLocator("iframe[data-epaper-frame]");
  const cover = frame.getByTestId("cover");
  await expect(cover).toBeVisible();
  await expect(cover.locator("img")).toHaveJSProperty("complete", true);
  await expect.poll(async () => (await page.locator("iframe[data-epaper-frame]").boundingBox())!.height).toBeGreaterThan(480);
  const popup = context.waitForEvent("page");
  await cover.click();
  const p = await popup;
  await expect(p).toHaveURL(/^http:\/\/127\.0\.0\.1:8185\/.*#\/latest\/1$/);
  await expect(p.getByTestId("pageno")).toHaveText("Page 1 / 24");
});

test("20 of 20 sampled taps open the right story", async ({ page, context }) => {
  await context.route("http://127.0.0.1:8190/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>article</title>" }));
  const { pages } = await latest(page);
  const sample: { no: number; z: Awaited<ReturnType<typeof zonesOf>>["zones"][number] }[] = [];
  for (let n = 1; n <= pages && sample.length < 20; n++)
    for (const z of (await zonesOf(page, n)).zones) if (z.article_id && byId.has(z.article_id) && sample.length < 20) sample.push({ no: n, z });
  expect(sample).toHaveLength(20);
  let ok = 0;
  for (const { no, z } of sample) {
    await page.goto(`/#/latest/${no}`);
    await expect(page.getByTestId("pageno")).toHaveText(`Page ${no} / 24`);
    await expect(page.locator(`.zone[data-zone="${z.id}"]`).first()).toBeAttached();
    const box = await sheetBox(page);
    // tap inside the zone's first rect, near its top-left so overlapping smaller zones are unlikely
    const [x, y, w, h] = z.rects[0];
    const popup = context.waitForEvent("page");
    await page.mouse.click(box.x + (x + w / 2) * box.width, box.y + (y + h / 2) * box.height);
    const p = await popup;
    await p.waitForLoadState();
    if (p.url() === byId.get(z.article_id!)!.url) ok++;
    await p.close();
  }
  expect(ok).toBe(20);
});

test("live: when the newsroom re-exports the edition, the open pages refresh by themselves (no reload) and say so", async ({ page, request }) => {
  await page.goto("/?poll=300#/latest/2");
  await expect(page.getByTestId("pageno")).toHaveText("Page 2 / 24");
  await expect(page.locator("header .date")).toHaveText("2026-11-18");
  await request.post(`${BASE}/__bump`);
  await expect(page.locator("header .date")).toHaveText("2026-11-19", { timeout: 8000 });
  await expect(page.getByTestId("note")).toContainText("This edition was updated");
  await expect(page.getByTestId("pageno")).toHaveText("Page 2 / 24"); // still on the page being read
});

test("top bar: links to the other apps; no user and no ops desk link for the public", async ({ page }) => {
  await page.goto("/#/latest/1");
  const bar = page.getByTestId("topbar");
  await expect(bar.getByRole("link", { name: "Reader", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("link", { name: "Editor", exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Admin", exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Ops desk" })).toHaveCount(0);
  await expect(page.getByTestId("sign-out")).toHaveCount(0);
  await expect(page.getByTestId("bell")).toHaveCount(0);
});

test("embed mode has no top bar", async ({ page }) => {
  await page.goto("/?embed=1#/latest/1");
  await expect(page.getByTestId("cover")).toBeVisible();
  await expect(page.getByTestId("topbar")).toHaveCount(0);
});
