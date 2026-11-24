// Live check of the editor in a real browser against the running stack (127.0.0.1:8100). Run from apps/editor:
//   node e2e-live/live.mjs <paper-slug> [page-numbers e.g. 1,2]
// Reads SEED_OWNER_PASSWORD from /srv/epaper/.env (never printed). Looks at: single click selects, a drag moves a block
// (then undo puts it back), Esc leaves text editing, and the line breaks of the whole page at editor zoom 25/50/100/200%.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const SLUG = process.argv[2] ?? "riverton-herald";
const PAGES = (process.argv[3] ?? "1").split(",").map(Number);
const pw = readFileSync("/srv/epaper/.env", "utf8").match(/^SEED_OWNER_PASSWORD=(.*)$/m)[1];
const BASE = "http://127.0.0.1:8100";
const out = []; const ok = (name, pass, note = "") => { out.push({ name, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${note ? "  " + note : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const r = await ctx.request.post(`${BASE}/v1/auth/login`, { data: { email: "owner@riverton.example", password: pw, paper: SLUG } });
if (r.status() !== 200) { console.log("login failed", r.status()); process.exit(1); }
const eds = (await (await ctx.request.get(`${BASE}/v1/editions`)).json()).items;
const edId = eds[0].id;
const page = await ctx.newPage();
const open = async (zoom, no) => {
  await page.goto(`${BASE}/?edition=${edId}&zoom=${zoom}&page=${no}`);
  await page.getByTestId("fill-meter").waitFor();
  await page.waitForFunction(() => /%/.test(document.querySelector('[data-testid="fill-meter"]')?.textContent ?? ""), null, { timeout: 60000 });
  await page.getByTestId(`page-tab-${no}`).click().catch(() => {});
  await page.locator(`.page[data-page="${no}"] .story`).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
};
// every line of every story, as text, read from the real layout with Range rectangles
const lines = () => page.evaluate(() => {
  const res = {};
  const pg = document.querySelector('.page'); const sc = pg.getBoundingClientRect().width / pg.offsetWidth; // zoom as a scale
  for (const s of document.querySelectorAll(".page .story")) {
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    const rows = []; let n;
    while ((n = walker.nextNode())) {
      const t = n.textContent ?? ""; if (!t.trim()) continue;
      const rg = document.createRange(); let lastTop = null, cur = "";
      // walk by grapheme clusters so a Tamil syllable is never split
      const segs = [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(t)];
      for (const g of segs) {
        rg.setStart(n, g.index); rg.setEnd(n, g.index + g.segment.length);
        const rect = rg.getClientRects()[0]; if (!rect || rect.width === 0) { cur += g.segment; continue; }
        const top = rect.top / sc;
        if (lastTop !== null && Math.abs(top - lastTop) > 3) { rows.push(cur); cur = ""; }
        lastTop = top; cur += g.segment;
      }
      if (cur) rows.push(cur);
    }
    res[s.dataset.item] = rows.map((x) => x.trim());
  }
  return res;
});

for (const no of PAGES) {
  // 1. zoom: identical line breaks
  const results = {};
  for (const z of [0.25, 0.5, 1, 2]) { await open(z, no); const zz = +(await page.getByTestId("fill-meter").getAttribute("data-zoom")); results[z] = { zz, l: await lines() }; }
  const base = JSON.stringify(results[1].l);
  for (const z of [0.25, 0.5, 2]) {
    const same = JSON.stringify(results[z].l) === base;
    ok(`page ${no}: line breaks at zoom ${z * 100}% (shown ${results[z].zz}) equal 100%`, same);
    if (!same) { const a = results[1].l, b = results[z].l; for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { console.log("   differs in", k, a[k]?.length, b[k]?.length); break; } }
  }
  console.log(`   page ${no}: ${Object.values(results[1].l).reduce((s, x) => s + x.length, 0)} lines compared`);

  // 2. select / Esc / drag at 100%
  await open(1, no);
  const first = page.locator(".page .story").first();
  const id = await first.getAttribute("data-item");
  await first.click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(300);
  ok(`page ${no}: one click selects the block (frame shown, no text editing)`, (await page.getByTestId("sel-frame").count()) > 0 && (await page.locator("[contenteditable=true]").count()) === 0);
  await first.locator(".head").dblclick();
  await page.waitForTimeout(300);
  const editing = (await page.locator("[contenteditable=true]").count()) > 0;
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  ok(`page ${no}: double click edits, Esc leaves editing`, editing && (await page.locator("[contenteditable=true]").count()) === 0 && (await first.evaluate((e) => document.activeElement === e)));
  const order = () => page.locator(".page .story").evaluateAll((e) => e.map((x) => x.dataset.item).join(","));
  const before = await order();
  const box = await first.boundingBox(); const stories = await page.locator(".page .story").evaluateAll((e) => e.map((x) => { const b = x.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }));
  const tgt = stories.slice(1).find((s) => s.y > 0 && s.y + s.h < 880) ?? stories[stories.length - 1]; // a block that is on screen
  if (box && tgt && stories.length > 1) { // a page with one block has nowhere to drag it
    await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down();
    const sx = box.x + 30, sy = box.y + 30, ex = tgt.x + tgt.w * 0.6, ey = tgt.y + tgt.h * 0.8;
    for (let i = 1; i <= 25; i++) { await page.mouse.move(sx + ((ex - sx) * i) / 25, sy + ((ey - sy) * i) / 25); await page.waitForTimeout(25); }
    await page.mouse.up(); await page.waitForTimeout(1500);
    const after = await order();
    ok(`page ${no}: dragging a block changes the order`, after !== before);
    await page.keyboard.press("Control+z"); await page.waitForTimeout(1500);
    ok(`page ${no}: undo puts it back`, (await order()) === before);
    await page.getByTestId("save-state").waitFor().catch(() => {});
    await page.waitForTimeout(3000);
  }
}
await page.screenshot({ path: process.env.SHOT ?? "/tmp/live-editor.png" });
await browser.close();
console.log(out.every((x) => x.pass) ? "ALL PASS" : "SOME FAILED");
process.exit(out.every((x) => x.pass) ? 0 : 1);
