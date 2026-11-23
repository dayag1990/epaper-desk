// Tamil line-break proof, editor side: the REAL editor build (vite preview) against the mock API serving the Tamil demo edition
// (8 planned pages + 2 proof pages: the 8 section headlines and 8 representative paragraphs).
// The text of every page is read back line by line from the editor's own DOM at editor zoom 0.5, 1.0 and 1.5 (also after pressing
// the zoom buttons, and on a 2x-density screen) and compared with the server's PDF (exportScreenPdf, text read with pdftotext).
import { expect, test, chromium, type Page } from "@playwright/test";
import { exportScreenPdf } from "../../../packages/export/dist/index.js";
import type { PageDoc } from "@epaper/core";
import { domLines, domReady, type DomLine, type Template } from "../../../packages/layout/dist/index.js";
import { badStart, matchPage, pdfFonts, pdfWords, squash } from "../../../tests/ta-type/lib/pdf.js";

const API = "http://127.0.0.1:8183";
interface Ed { pages: { no: number; doc: PageDoc; template_id: string }[]; templates: Template[]; articles: any[] }

// the proof test at the end reads what the zoom tests collected, so the order is fixed
test.describe.configure({ mode: "serial" });

let ed: Ed;
test.beforeAll(async ({ request }) => {
  const r = await request.get(`${API}/v1/editions/ed_ta`, { headers: { "x-mock-user": "ana" } });
  expect(r.status()).toBe(200);
  ed = await r.json();
  expect(ed.pages.map((p) => p.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
test.beforeEach(async ({ request }) => { await request.post(`${API}/__reset`); });

const edition = () => ed.pages.map((p) => ({ doc: p.doc, template: ed.templates.find((t) => t.id === p.doc.page.template)! }));

async function openAt(page: Page, zoom: number) {
  await page.addInitScript(([cfg]) => { (window as any).__EPAPER_CONFIG__ = cfg; }, [{ apiBase: API, mockUser: "ana", edition: "ed_ta", zoom, autosaveMs: 300, lockPollMs: 700, retryMs: 500 }]);
  await page.goto("/");
  await expect(page.getByTestId("fill-meter")).toContainText(/%/, { timeout: 30000 });
}
/** Show page `no` in the editor and read every line of it. */
async function linesOf(page: Page, no: number): Promise<DomLine[]> {
  if (no !== 1 || !(await page.locator('.page[data-page="1"]').count())) await page.getByTestId(`page-tab-${no}`).click();
  await expect(page.locator(`.page[data-page="${no}"]`)).toBeVisible();
  await expect(page.getByTestId("fill-meter")).toContainText(/%/, { timeout: 30000 });
  await page.evaluate(domReady);
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".page")?.dataset.page), { timeout: 10000 }).toBe(String(no));
  // the editor's own refit has run (the meter shows a fill) and fonts are in: no more changes are coming
  const a = await page.evaluate(domLines);
  await page.waitForTimeout(150);
  const b = await page.evaluate(domLines);
  expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  return b;
}
const texts = (ls: DomLine[]) => ls.map((l) => `${l.key}#${l.n}|${l.text}`);

const zoomRuns: Record<string, Record<number, DomLine[]>> = {};
const fontReq: string[] = [];

for (const zoom of [1, 0.5, 1.5]) {
  test(`editor at zoom ${zoom}: fonts come from /fonts and are loaded, lines read`, async ({ page }) => {
    page.on("request", (r) => { if (r.url().includes("/fonts/")) fontReq.push(r.url()); });
    await openAt(page, zoom);
    expect(+(await page.getByTestId("fill-meter").getAttribute("data-zoom"))!).toBeCloseTo(zoom, 3);
    const run: Record<number, DomLine[]> = {};
    for (const p of ed.pages) run[p.no] = await linesOf(page, p.no);
    zoomRuns[`z${zoom}`] = run;
    // both families are loaded web fonts, nothing is waiting
    const faces = await page.evaluate(() => { const f: { family: string; status: string }[] = []; document.fonts.forEach((x) => f.push({ family: x.family, status: x.status })); return f; });
    expect(faces.map((f) => `${f.family}:${f.status}`).sort()).toEqual(["Anek Tamil:loaded", "Noto Serif Tamil:loaded"]);
    // the page really is laid out on the canvas and only scaled: the page box is canvas px wide before the transform
    const geo = await page.evaluate(() => { const p = document.querySelector<HTMLElement>(".page")!; return { w: p.offsetWidth, rect: p.getBoundingClientRect().width, z: getComputedStyle(p).transform }; });
    expect(geo.w).toBe(ed.templates[0]!.canvas_px);
    expect(geo.rect / geo.w).toBeCloseTo(zoom, 3);
  });
}

test("editor on a 2x screen at zoom 1 breaks the same lines", async ({ browser }) => {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await openAt(page, 1);
  const run: Record<number, DomLine[]> = {};
  for (const p of ed.pages) run[p.no] = await linesOf(page, p.no);
  zoomRuns.dsf2 = run;
  await ctx.close();
});

test("zoom buttons: lines are unchanged after zooming in and out, with the page re-fitted each time", async ({ page }) => {
  await openAt(page, 1);
  const run: Record<number, DomLine[]> = {};
  const clicks: [string, number][] = [["Zoom in", 1.25], ["Zoom out", 1], ["Zoom out", 0.8], ["Zoom out", 0.64]];
  for (const [name, z] of clicks) {
    await page.getByRole("button", { name }).click();
    await expect.poll(async () => +(await page.getByTestId("fill-meter").getAttribute("data-zoom"))!).toBeCloseTo(z, 2);
    for (const no of [3, 7, 9, 10]) { const ls = await linesOf(page, no); run[no] ??= ls; expect(texts(ls), `page ${no} at zoom ${z}`).toEqual(texts(run[no]!)); }
  }
  zoomRuns.buttons = run;
});

test("PROOF: editor 0.5 / 1.0 / 1.5 / 2x / buttons = server PDF, line for line; no broken clusters; fonts embedded; NFC round trip", async () => {
  const ref = zoomRuns.z1!;
  expect(ref, "the zoom 1 run must have happened first").toBeTruthy();
  const report: string[] = [];
  let total = 0, firstWords = 0;
  for (const name of ["z0.5", "z1.5", "dsf2", "buttons"]) {
    const run = zoomRuns[name]!;
    expect(run, name).toBeTruthy();
    for (const [no, ls] of Object.entries(run)) {
      expect(texts(ls), `editor ${name}, page ${no}`).toEqual(texts(ref[+no]!));
      expect(ls.map((l) => l.first), `first words ${name}, page ${no}`).toEqual(ref[+no]!.map((l) => l.first));
    }
    report.push(`${name}: ${Object.values(run).reduce((n, l) => n + l.length, 0)} lines identical to zoom 1`);
  }

  // the server's PDF of the same pages
  const browser = await chromium.launch();
  const pdf = await exportScreenPdf({ paper: "ta", date: "2026-11-24", pages: edition(), articles: ed.articles, browser });
  await browser.close();
  const ws = pdfWords(pdf.edition.bytes);
  const k = (381 / 25.4 * 72) / ed.templates[0]!.canvas_px;
  const byKey = new Map<string, string[]>();
  for (const p of ed.pages) {
    const ls = ref[p.no]!;
    const { matched, stray } = matchPage(ls, ws.filter((w) => w.page === p.no), k);
    expect(stray.map((w) => w.text), `PDF page ${p.no}: words not on any editor line`).toEqual([]);
    for (const m of matched) {
      total++;
      expect(squash(m.pdf), `PDF line differs from editor line ${m.line.key}#${m.line.n} on page ${p.no}`).toBe(squash(m.line.text));
      // first word of the line is identical (the PDF line starts with exactly the editor's first word)
      expect(squash(m.pdf).startsWith(squash(m.line.first)), `${m.line.key}#${m.line.n} first word`).toBe(true);
      firstWords++;
      expect(badStart(m.line.text), `editor line starts with a combining mark: ${m.line.text}`).toBe(false);
      expect(badStart(m.pdf.replace(/^\s+/, "")), `PDF line starts with a combining mark: ${m.pdf}`).toBe(false);
      (byKey.get(`${p.no}|${m.line.key}`) ?? byKey.set(`${p.no}|${m.line.key}`, []).get(`${p.no}|${m.line.key}`)!).push(m.pdf);
    }
  }
  // NFC round trip: the text of every headline, sub-head, kicker and paragraph comes out of the PDF unchanged
  let elements = 0;
  for (const p of ed.pages) for (const it of p.doc.items) {
    const want: [string, string | null | undefined][] = [[`${it.id}.kicker`, it.text?.kicker], [`${it.id}.head`, it.text?.head], [`${it.id}.sub`, it.text?.sub]];
    (it.text?.body ?? []).forEach((b, i) => want.push([`${it.id}.body.${i}`, b]));
    for (const [key, src] of want) {
      if (!src) continue;
      expect(src.normalize("NFC"), `${key} is NFC in the document`).toBe(src);
      const got = (byKey.get(`${p.no}|${key}`) ?? []).join("");
      expect(squash(got), `PDF text of ${key} (page ${p.no})`).toBe(squash(src));
      elements++;
    }
  }
  // fonts
  const fonts = pdfFonts(pdf.edition.bytes);
  expect(fonts.length).toBeGreaterThan(1);
  expect(fonts.every((f) => f.emb), JSON.stringify(fonts)).toBe(true);
  expect(fonts.some((f) => /NotoSerifTamil/.test(f.name))).toBe(true);
  expect(fonts.some((f) => /AnekTamil/.test(f.name))).toBe(true);
  // the editor fetched the font files from the API route, nothing else
  expect([...new Set(fontReq.map((u) => decodeURIComponent(new URL(u).pathname)))].sort()).toEqual(["/fonts/anek-tamil/AnekTamil[wdth,wght].ttf", "/fonts/noto-serif-tamil/NotoSerifTamil[wdth,wght].ttf"]);
  console.log(`LINE-BREAK PROOF (editor): ${report.join("; ")}; ${total} lines on ${ed.pages.length} pages match the PDF; first word identical on ${firstWords}; ${elements} text elements round-trip through the PDF as exact NFC text; PDF fonts: ${[...new Set(fonts.map((f) => f.name.replace(/^[A-Z]+\+/, "")))].join(", ")} (all embedded: ${fonts.every((f) => f.emb)})`);
});
