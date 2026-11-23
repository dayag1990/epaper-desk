import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { PageDocSchema } from "@epaper/core";

/** Select / edit / drag / resize / keyboard, with the real mouse and keyboard at desktop size (1440x900). */
test.use({ viewport: { width: 1440, height: 900 } });
const API = "http://127.0.0.1:8181";
const SHOTS = "e2e-screens";

async function open(page: Page, user = "ana", tab = 2) {
  await page.addInitScript(
    ([cfg]) => { (window as any).__EPAPER_CONFIG__ = cfg; },
    [{ apiBase: API, mockUser: user, edition: "ed_demo", autosaveMs: 300, lockPollMs: 700, retryMs: 500 }],
  );
  await page.goto("/");
  await expect(page.getByTestId("fill-meter")).toContainText(/%/, { timeout: 15000 });
  await page.getByTestId(`page-tab-${tab}`).click();
  await expect(page.locator(".page")).toHaveAttribute("data-page", String(tab));
  await expect(page.locator(".page .story").first()).toBeVisible();
}
const blk = (page: Page, id: string) => page.locator(`.page .story[data-item="${id}"]`);
const frame = (page: Page) => page.getByTestId("sel-frame");
const readout = (page: Page) => page.getByTestId("sel-readout");
const meter = (page: Page) => page.getByTestId("fill-meter");
const refits = async (page: Page) => +((await meter(page).getAttribute("data-refits")) ?? 0);
const zoomOf = async (page: Page) => +((await meter(page).getAttribute("data-zoom")) ?? 1);
const order = (page: Page) => page.locator(".page .story").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.item));

interface Geo { zoom: number; gridLeft: number; gridW: number; gap: number; pitch: number; pitchCss: number; stories: { id: string; x: number; y: number; w: number; h: number; span: number; cols: number; row: number; col: number }[] }
async function geo(page: Page): Promise<Geo> {
  const z = await zoomOf(page);
  return page.evaluate((zoom) => {
    const pg = document.querySelector(".page") as HTMLElement;
    const grid = document.querySelector(".grid") as HTMLElement;
    const scale = pg.getBoundingClientRect().width / pg.offsetWidth;
    const gapCss = parseFloat(getComputedStyle(grid).columnGap);
    const gr = grid.getBoundingClientRect();
    const gap = gapCss * scale, pitch = (gr.width + gap) / 8;
    let row = -1, prevX = Infinity;
    const stories = [...document.querySelectorAll<HTMLElement>(".page .story")].map((s) => {
      const r = s.getBoundingClientRect();
      if (r.x <= prevX + 0.5) row++;
      prevX = r.x;
      return { id: s.dataset.item!, x: r.x, y: r.y, w: r.width, h: r.height, span: +s.dataset.span!, cols: +s.dataset.cols!, row, col: Math.round((r.x - gr.left) / pitch) };
    });
    return { zoom, gridLeft: gr.left, gridW: gr.width, gap, pitch, pitchCss: (grid.offsetWidth + gapCss) / 8, stories };
  }, z);
}
const widthOf = (g: Geo, span: number) => span * g.pitch - g.gap;
const active = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  const sel = getSelection();
  const n = sel?.focusNode ?? null;
  const inEditable = !!(n && (n.nodeType === 3 ? n.parentElement : (n as HTMLElement))?.closest?.("[contenteditable=true]"));
  return { tag: a?.tagName ?? "", editable: !!a?.isContentEditable, isInput: /^(INPUT|TEXTAREA)$/.test(a?.tagName ?? ""), item: a?.dataset?.item ?? null, cls: a?.className ?? "", caretInEditable: inEditable, collapsed: sel?.isCollapsed ?? true, editableCount: document.querySelectorAll("[contenteditable=true]").length };
});
async function savedPage(request: APIRequestContext, id = "pg_two") {
  const ed = await (await request.get(`${API}/v1/editions/ed_demo`)).json();
  return ed.pages.find((p: any) => p.id === id).doc;
}
const settle = async (page: Page) => { await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10000 }); };
const spansOf = (doc: any) => Object.fromEntries(doc.items.map((i: any) => [i.id, [i.span, i.cols]]));
async function expectValid(request: APIRequestContext, id = "pg_two") {
  const doc = await savedPage(request, id);
  const r = PageDocSchema.safeParse(doc);
  expect(r.success, JSON.stringify(r.success ? "" : r.error.issues)).toBe(true);
  return doc;
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
/** The frame sits exactly on the selected block, and every handle sits on the block's edge/corner/middle (within 1 px). */
async function expectGlued(page: Page, id: string, handles = true) {
  await expect.poll(async () => {
    const b = await blk(page, id).boundingBox();
    const f = await frame(page).boundingBox();
    if (!b || !f) return 99;
    return Math.max(Math.abs(b.x - f.x), Math.abs(b.y - f.y), Math.abs(b.width - f.width), Math.abs(b.height - f.height));
  }, { timeout: 5000 }).toBeLessThan(1.01);
  if (!handles) return;
  const b = (await blk(page, id).boundingBox())!;
  const at: Record<string, [number, number]> = {
    nw: [b.x, b.y], n: [b.x + b.width / 2, b.y], ne: [b.x + b.width, b.y], w: [b.x, b.y + b.height / 2], e: [b.x + b.width, b.y + b.height / 2],
    sw: [b.x, b.y + b.height], s: [b.x + b.width / 2, b.y + b.height], se: [b.x + b.width, b.y + b.height],
  };
  for (const [h, [cx, cy]] of Object.entries(at)) {
    const hb = (await page.getByTestId(`handle-${h}`).boundingBox())!;
    expect(Math.abs(hb.x + hb.width / 2 - cx), `${h} x`).toBeLessThan(1.01);
    expect(Math.abs(hb.y + hb.height / 2 - cy), `${h} y`).toBeLessThan(1.01);
  }
}
async function select(page: Page, id: string, handles = true) {
  await blk(page, id).locator(".head").click();
  await expect(blk(page, id)).toHaveAttribute("aria-pressed", "true");
  await expectGlued(page, id, handles);
}
/** Press the real zoom button until the editor zoom is near `target`. */
async function zoomTo(page: Page, target: number) {
  for (let i = 0; i < 12; i++) {
    const z = await zoomOf(page);
    if (Math.abs(z - target) < 0.1) break;
    await page.getByRole("button", { name: z < target ? "Zoom in" : "Zoom out" }).click();
    await expect.poll(() => zoomOf(page)).not.toBe(z);
  }
  expect(Math.abs((await zoomOf(page)) - target)).toBeLessThan(0.1);
}
const centre = async (l: Locator) => { const b = (await l.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  if (hold) await hold();
  await page.mouse.up();
}
const scrollStage = (page: Page, left: number, top: number) => page.getByTestId("stage").evaluate((e, [l, t]) => { e.scrollTo(l!, t!); }, [left, top]);

test.beforeEach(async ({ request }) => {
  await request.post(`${API}/__reset`);
  await request.post(`${API}/__config`, { data: { ai: false, cutout: false, lockTtlMs: 300000 } });
});

test("a) single click selects: frame and handles, no caret, typing does nothing", async ({ page, request }) => {
  await open(page);
  await zoomTo(page, 0.4);
  const before = await savedPage(request);
  const head0 = await blk(page, "it_2x1").locator(".head").innerText();
  await select(page, "it_2x1");
  await expect(frame(page)).toBeVisible();
  await expect(page.locator("[data-handle]")).toHaveCount(8);
  for (const h of await page.locator("[data-handle]").all()) await expect(h).toBeVisible();
  await expect(readout(page)).toContainText("Width 5 of 8");
  const a = await active(page);
  expect(a.editable || a.isInput).toBe(false);
  expect(a.item).toBe("it_2x1");
  expect(a.editableCount).toBe(0);
  expect(a.caretInEditable).toBe(false);
  await page.keyboard.type("zzz");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(blk(page, "it_2x1").locator(".head")).toHaveText(head0);
  await expect(page.locator(".page .story")).toHaveCount(3);
  await settle(page);
  expect(JSON.stringify(await savedPage(request))).toBe(JSON.stringify(before));
  await shot(page, "a-select");
});

test("b) double click edits, Esc goes back to selection, Esc again deselects", async ({ page, request }) => {
  await open(page);
  await zoomTo(page, 0.4);
  await select(page, "it_2x1");
  const head = blk(page, "it_2x1").locator(".head");
  const orig = await head.innerText();
  await head.dblclick();
  await expect(head).toHaveAttribute("contenteditable", "true");
  let a = await active(page);
  expect(a.editable).toBe(true);
  expect(a.cls).toContain("head");
  expect(a.collapsed && a.caretInEditable).toBe(true);
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" TYPEDHERE");
  await expect(head).toContainText("TYPEDHERE");
  await settle(page);
  expect(JSON.stringify(await savedPage(request))).toContain("TYPEDHERE");
  await shot(page, "b-edit");
  await page.keyboard.press("Escape");
  await expect(page.locator("[contenteditable=true]")).toHaveCount(0);
  await expect(frame(page)).toBeVisible();
  await expect(page.locator("[data-handle]")).toHaveCount(8);
  await expect(blk(page, "it_2x1")).toHaveAttribute("aria-pressed", "true");
  a = await active(page);
  expect(a.item).toBe("it_2x1");
  expect(a.editable).toBe(false);
  await expect(head).toHaveText(orig + " TYPEDHERE");
  await page.keyboard.press("Escape");
  await expect(frame(page)).toHaveCount(0);
  await expect(blk(page, "it_2x1")).toHaveAttribute("aria-pressed", "false");
  // Enter on a selected block edits too; clicking the empty page deselects
  await select(page, "it_2x2");
  await page.keyboard.press("Enter");
  await expect(blk(page, "it_2x2").locator(".head")).toHaveAttribute("contenteditable", "true");
  await page.keyboard.press("Escape");
  await expect(blk(page, "it_2x2")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("stage").click({ position: { x: 4, y: 400 } });
  await expect(frame(page)).toHaveCount(0);
});

test("c) drag a block to another slot: grid overlay, snapped marker, order changes, refit runs", async ({ page, request }) => {
  await open(page);
  await zoomTo(page, 0.4);
  await select(page, "it_2x2");
  expect(await order(page)).toEqual(["it_2x1", "it_2x2", "it_2x3"]);
  // 1) B before A (first row, first column)
  let g = await geo(page);
  const A = g.stories[0]!, B = g.stories[1]!;
  const r0 = await refits(page);
  await expect(page.getByTestId("grid-overlay")).toHaveCount(0);
  let mark = { x: 0, w: 0, col: "", row: "", index: "" };
  await dragTo(page, { x: B.x + B.w / 2, y: B.y + 30 }, { x: A.x + 12, y: A.y + 12 }, async () => {
    await expect(page.getByTestId("grid-overlay")).toBeVisible();
    await expect(page.locator(".gcol")).toHaveCount(8);
    const m = page.getByTestId("drop-marker");
    await expect(m).toBeVisible();
    const mb = (await m.boundingBox())!;
    mark = { x: mb.x, w: mb.width, col: (await m.getAttribute("data-col"))!, row: (await m.getAttribute("data-row"))!, index: (await m.getAttribute("data-index"))! };
    expect(Math.abs(mb.x - g.gridLeft)).toBeLessThan(1.5);
    await shot(page, "c-drag-in-progress");
  });
  expect(mark.index).toBe("0");
  await expect(page.getByTestId("grid-overlay")).toHaveCount(0);
  await expect.poll(() => order(page)).toEqual(["it_2x2", "it_2x1", "it_2x3"]);
  g = await geo(page);
  const nb = g.stories[0]!;
  expect(Math.abs(nb.x - mark.x)).toBeLessThan(1.5);
  expect(Math.abs(nb.w - mark.w)).toBeLessThan(1.5);
  expect(nb.col).toBe(+mark.col);
  expect(nb.row).toBe(+mark.row);
  await expect.poll(() => refits(page)).toBeGreaterThan(r0);
  await expect(blk(page, "it_2x2")).toHaveAttribute("aria-pressed", "true");
  await settle(page);
  let doc = await expectValid(request);
  expect(doc.items.map((i: any) => i.id)).toEqual(["it_2x2", "it_2x1", "it_2x3"]);
  expect(spansOf(doc).it_2x2[0]).toBe(3); // span unchanged
  // undo is one step
  await page.getByTestId("undo").click();
  await expect.poll(() => order(page)).toEqual(["it_2x1", "it_2x2", "it_2x3"]);
  await page.getByTestId("redo").click();
  await expect.poll(() => order(page)).toEqual(["it_2x2", "it_2x1", "it_2x3"]);
  // 2) the same block to a new row at the end (below the last block)
  await expectGlued(page, "it_2x2");
  g = await geo(page);
  const C = g.stories[2]!, M = g.stories[0]!;
  const r1 = await refits(page);
  await dragTo(page, { x: M.x + M.w / 2, y: M.y + 30 }, { x: C.x + 30, y: C.y + C.h + 6 }, async () => {
    const m = page.getByTestId("drop-marker");
    await expect(m).toBeVisible();
    expect(await m.getAttribute("data-index")).toBe("2");
    mark.x = (await m.boundingBox())!.x;
    mark.row = (await m.getAttribute("data-row"))!;
  });
  await expect.poll(() => order(page)).toEqual(["it_2x1", "it_2x3", "it_2x2"]);
  g = await geo(page);
  expect(Math.abs(g.stories[2]!.x - mark.x)).toBeLessThan(1.5);
  expect(g.stories[2]!.row).toBe(+mark.row);
  await expect.poll(() => refits(page)).toBeGreaterThan(r1);
  await settle(page);
  doc = await expectValid(request);
  expect(doc.items.map((i: any) => i.id)).toEqual(["it_2x1", "it_2x3", "it_2x2"]);
  await shot(page, "c-dropped");
});

test("c2) a drag shorter than 4 px is a click and never edits", async ({ page, request }) => {
  await open(page);
  await zoomTo(page, 0.4);
  const b = await centre(blk(page, "it_2x2").locator(".head"));
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 2, b.y + 1);
  await expect(page.getByTestId("grid-overlay")).toHaveCount(0);
  await page.mouse.up();
  await expect(blk(page, "it_2x2")).toHaveAttribute("aria-pressed", "true");
  expect((await active(page)).editableCount).toBe(0);
  expect(await order(page)).toEqual(["it_2x1", "it_2x2", "it_2x3"]);
  // a real drag never leaves a block in edit mode either
  const A = (await geo(page)).stories[0]!;
  await dragTo(page, { x: b.x, y: b.y }, { x: A.x + 10, y: A.y + 10 });
  await expect.poll(() => order(page)).toEqual(["it_2x2", "it_2x1", "it_2x3"]);
  expect((await active(page)).editableCount).toBe(0);
  expect((await active(page)).editable).toBe(false);
  void request;
});

test("d) arrow keys: order, rows, width, text columns; one undo for a key run", async ({ page, request }) => {
  await open(page, "ana", 1);
  await zoomTo(page, 0.4);
  const id = "it_1x4"; // 2 wide, second row of page 1
  await select(page, id);
  const pos = async () => (await geo(page)).stories.find((s) => s.id === id)!;
  const place = async () => +((await readout(page).getAttribute("data-place")) ?? 0);
  const r0 = await refits(page);
  const start = await order(page);
  expect(await place()).toBe(4);
  // Right / Left: one place later / earlier
  await page.keyboard.press("ArrowRight");
  await expect.poll(place).toBe(5);
  expect((await order(page)).indexOf(id)).toBe(4);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(place).toBe(4);
  expect(await order(page)).toEqual(start);
  await expect(blk(page, id)).toBeFocused();
  // Up / Down: row above / below
  const y0 = (await pos()).y;
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await pos()).y).toBeLessThan(y0 - 1);
  const yUp = (await pos()).y;
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await pos()).y).toBeGreaterThan(yUp + 1);
  await expect.poll(() => refits(page)).toBeGreaterThan(r0);
  await settle(page);
  await expectValid(request, "pg_front");
  await page.getByTestId("undo").click(); await page.getByTestId("undo").click(); await page.getByTestId("undo").click(); await page.getByTestId("undo").click();
  await expect.poll(() => order(page)).toEqual(start);
  await shot(page, "d-keys-order");

  // Shift+Left/Right on the wide first block: exactly one column per press
  const first = "it_1x1";
  await select(page, first);
  const w0 = (await geo(page)).stories[0]!;
  expect(w0.span).toBe(5);
  const g0 = await geo(page);
  const spanNow = async () => +((await readout(page).getAttribute("data-span")) ?? 0);
  const rBefore = await refits(page);
  for (const want of [4, 3]) { // a held key: repeated presses, one run
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(spanNow).toBe(want);
  }
  expect(Math.abs((await geo(page)).stories[0]!.w - widthOf(g0, 3))).toBeLessThan(1.01);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(spanNow).toBe(4);
  const g1 = await geo(page);
  expect(Math.abs(g1.stories[0]!.w - widthOf(g1, 4))).toBeLessThan(1.01);
  expect(Math.abs(g1.stories[0]!.w - (widthOf(g0, 3) + g0.pitch))).toBeLessThan(1.01); // grew by one column pitch
  await expect.poll(() => refits(page)).toBeGreaterThan(rBefore);
  // text columns
  const colsNow = async () => +((await readout(page).getAttribute("data-cols")) ?? 0);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(colsNow).toBeLessThanOrEqual(3);
  const c1 = await colsNow();
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(colsNow).toBe(c1 + 1);
  await expect.poll(async () => +((await blk(page, first).getAttribute("data-cols")) ?? 0)).toBe(c1 + 1);
  await settle(page);
  const doc = await expectValid(request, "pg_front");
  expect(spansOf(doc)[first]).toEqual([4, c1 + 1]);
  await shot(page, "d-keys-width");

  // one undo step for one run: fresh start, hold Shift+Left three times, press undo once
  await request.post(`${API}/__reset`);
  await page.reload();
  await expect(meter(page)).toContainText(/%/, { timeout: 15000 });
  await select(page, first);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(spanNow).toBe(2);
  await page.getByTestId("undo").click();
  await expect.poll(async () => +((await blk(page, first).getAttribute("data-span")) ?? 0)).toBe(5);
  await expect(page.getByTestId("undo")).toBeDisabled();
});

test("e) resize handles snap to whole columns and refit", async ({ page, request }) => {
  await open(page, "ana", 1);
  await zoomTo(page, 0.4);
  await select(page, "it_1x1");
  const first = () => geo(page).then((g) => g.stories.find((s) => s.id === "it_1x1")!);
  let g = await geo(page);
  let s = await first();
  expect(s.span).toBe(5);
  // right edge: narrow by 2 columns
  let r = await refits(page);
  let h = await centre(page.getByTestId("handle-e"));
  let ghostSpan = "";
  await dragTo(page, { x: h.x, y: h.y }, { x: h.x - 2 * g.pitch, y: h.y }, async () => {
    const gh = page.getByTestId("resize-ghost");
    await expect(gh).toBeVisible();
    await expect(gh).toHaveAttribute("data-span", "3");
    ghostSpan = (await gh.getAttribute("data-span"))!;
    await expect(page.getByTestId("grid-overlay")).toBeVisible();
    await shot(page, "e-resize-ghost");
  });
  expect(ghostSpan).toBe("3");
  await expect.poll(async () => (await first()).span).toBe(3);
  g = await geo(page);
  expect(Math.abs((await first()).w - widthOf(g, 3))).toBeLessThan(1.01);
  await expect.poll(() => refits(page)).toBeGreaterThan(r);
  await expectGlued(page, "it_1x1");
  // right edge: widen by 2 columns, with a slightly sloppy pointer (snaps)
  r = await refits(page);
  h = await centre(page.getByTestId("handle-e"));
  await dragTo(page, { x: h.x, y: h.y }, { x: h.x + 2 * g.pitch + g.pitch * 0.3, y: h.y + 4 });
  await expect.poll(async () => (await first()).span).toBe(5);
  g = await geo(page);
  expect(Math.abs((await first()).w - widthOf(g, 5))).toBeLessThan(1.01);
  await expect.poll(() => refits(page)).toBeGreaterThan(r);
  await settle(page);
  let doc = await expectValid(request, "pg_front");
  expect(spansOf(doc).it_1x1[0]).toBe(5);

  // left edge of the second block: one column wider to the left, its right edge stays where it was
  await select(page, "it_1x2");
  g = await geo(page);
  const b0 = g.stories.find((x) => x.id === "it_1x2")!;
  expect(b0.span).toBe(3);
  r = await refits(page);
  h = await centre(page.getByTestId("handle-w"));
  await dragTo(page, { x: h.x, y: h.y }, { x: h.x - g.pitch, y: h.y });
  await expect.poll(async () => (await geo(page)).stories.find((x) => x.id === "it_1x2")!.span).toBe(4);
  g = await geo(page);
  const b1 = g.stories.find((x) => x.id === "it_1x2")!;
  expect(Math.abs(b1.w - widthOf(g, 4))).toBeLessThan(1.01);
  expect(Math.abs(b1.x + b1.w - (b0.x + b0.w))).toBeLessThan(1.01); // right edge fixed
  expect(g.stories.find((x) => x.id === "it_1x1")!.span).toBe(4); // the row-mate gave the column up
  await expect.poll(() => refits(page)).toBeGreaterThan(r);
  // left edge back (narrower by one)
  h = await centre(page.getByTestId("handle-w"));
  await dragTo(page, { x: h.x, y: h.y }, { x: h.x + g.pitch, y: h.y });
  await expect.poll(async () => (await geo(page)).stories.find((x) => x.id === "it_1x2")!.span).toBe(3);
  await settle(page);
  doc = await expectValid(request, "pg_front");

  // bottom edge: text columns. Pull it down = taller = fewer columns
  await select(page, "it_1x1");
  const colsOf = async () => (await first()).cols;
  const cStart = await colsOf();
  expect(cStart).toBe(5);
  r = await refits(page);
  h = await centre(page.getByTestId("handle-s"));
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  let y = h.y + 6;
  await page.mouse.move(h.x, y);
  const gh = page.getByTestId("resize-ghost");
  await expect(gh).toBeVisible();
  while (y < h.y + 600 && (await gh.getAttribute("data-cols", { timeout: 2000 })) !== "2") {
    y += 6;
    await page.mouse.move(h.x, y);
  }
  await expect(gh).toHaveAttribute("data-cols", "2");
  await page.mouse.up();
  await expect.poll(colsOf).toBe(2);
  await expect.poll(() => refits(page)).toBeGreaterThan(r);
  await settle(page);
  doc = await expectValid(request, "pg_front");
  expect(spansOf(doc).it_1x1[1]).toBe(2);
  await shot(page, "e-resized");
});

test("g) viewer: selection only, no drag, keys, resize or editing", async ({ page, request }) => {
  await open(page, "vic");
  await zoomTo(page, 0.4);
  const before = await savedPage(request);
  await select(page, "it_2x2", false);
  await expect(blk(page, "it_2x2")).toHaveAttribute("aria-pressed", "true");
  await expect(frame(page)).toBeVisible();
  await expect(page.locator("[data-handle]")).toHaveCount(0);
  const o = await order(page);
  const A = (await geo(page)).stories[0]!;
  const b = await centre(blk(page, "it_2x2").locator(".head"));
  await dragTo(page, { x: b.x, y: b.y }, { x: A.x + 10, y: A.y + 10 }, async () => {
    await expect(page.getByTestId("grid-overlay")).toHaveCount(0);
  });
  expect(await order(page)).toEqual(o);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type("zzz");
  await blk(page, "it_2x2").locator(".head").dblclick();
  expect((await active(page)).editableCount).toBe(0);
  expect(await order(page)).toEqual(o);
  await expect(readout(page)).toContainText("Width 3 of 8");
  await expect(page.getByTestId("undo")).toBeDisabled();
  expect(JSON.stringify(await savedPage(request))).toBe(JSON.stringify(before));
  await shot(page, "g-viewer");
});

test("g2) a page locked by someone else is selection only", async ({ browser, request }) => {
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 } }), b = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pa = await a.newPage(), pb = await b.newPage();
  await open(pa, "ana");
  await open(pb, "bea");
  await expect(pb.getByTestId("lock-banner")).toContainText("Ana Costa");
  await pb.locator(`.page .story[data-item="it_2x2"] .head`).click();
  await expect(frame(pb)).toBeVisible();
  await expect(pb.locator("[data-handle]")).toHaveCount(0);
  await pb.keyboard.press("Shift+ArrowLeft");
  await pb.locator(`.page .story[data-item="it_2x2"] .head`).dblclick();
  expect((await active(pb)).editableCount).toBe(0);
  expect((await readout(pb).getAttribute("data-span"))).toBe("3");
  void request;
  await a.close(); await b.close();
});

for (const target of [0.5, 1.5]) {
  test(`zoom ${target}: frame glued, drag, resize, edit and Esc work at this editor zoom`, async ({ page, request }) => {
    await open(page, "ana", 1);
    const id = "it_1x3"; // row 2 of page 1: 3 wide, next to the 2-wide it_1x4
    await select(page, id);
    // zoom with the real buttons: the selection stays, stays in view, and the handles stay on the block after every click
    const stage = page.getByTestId("stage");
    for (let i = 0; i < 10; i++) {
      const z = await zoomOf(page);
      if (Math.abs(z - target) < 0.1) break;
      await page.getByRole("button", { name: z < target ? "Zoom in" : "Zoom out" }).click();
      await expect.poll(() => zoomOf(page)).not.toBe(z);
      await expect(blk(page, id)).toHaveAttribute("aria-pressed", "true");
      await expectGlued(page, id);
      const sb = (await stage.boundingBox())!, bb = (await blk(page, id).boundingBox())!;
      const overlapX = Math.min(bb.x + bb.width, sb.x + sb.width) - Math.max(bb.x, sb.x);
      const overlapY = Math.min(bb.y + bb.height, sb.y + sb.height) - Math.max(bb.y, sb.y);
      expect(overlapX > 50 && overlapY > 50, "selected block stays in view").toBe(true);
    }
    expect(Math.abs((await zoomOf(page)) - target)).toBeLessThan(0.1);

    // double click + Esc: the caret lands where the pointer was
    const head = blk(page, id).locator(".head");
    await head.scrollIntoViewIfNeeded();
    await head.dblclick({ position: { x: 4, y: 6 } });
    await expect(head).toHaveAttribute("contenteditable", "true");
    const caret = await page.evaluate(() => { const s = getSelection()!; return { off: s.focusOffset, collapsed: s.isCollapsed, inHead: !!(s.focusNode && (s.focusNode.nodeType === 3 ? s.focusNode.parentElement : (s.focusNode as HTMLElement))?.closest(".head")) }; });
    expect(caret.inHead && caret.collapsed).toBe(true);
    expect(caret.off).toBeLessThan(6);
    await page.keyboard.type("Q");
    await expect(head).toContainText("Q");
    await page.keyboard.press("Escape");
    await expect(page.locator("[contenteditable=true]")).toHaveCount(0);
    await expect(blk(page, id)).toBeFocused();
    await expectGlued(page, id);

    // drag it to the right of it_1x4 (same row). Bring the grip and the drop point on screen.
    let g = await geo(page);
    const sb = (await stage.boundingBox())!;
    const next = g.stories.find((x) => x.id === "it_1x4")!;
    const dropX = next.x + next.w * 0.8;
    if (dropX > sb.x + sb.width - 30) await stage.evaluate((e, dx) => e.scrollBy(dx, 0), dropX - (sb.x + sb.width - 60));
    g = await geo(page);
    const nx = g.stories.find((x) => x.id === "it_1x4")!;
    const grip = await centre(page.getByTestId("handle-n"));
    expect(grip.x > sb.x + 5 && grip.y > sb.y + 5 && grip.y < sb.y + sb.height - 5, `grip on screen ${grip.x},${grip.y}`).toBe(true);
    const r0 = await refits(page);
    let markX = 0, markW = 0, markCol = "";
    await dragTo(page, grip, { x: nx.x + nx.w * 0.8, y: nx.y + 40 }, async () => {
      await expect(page.getByTestId("grid-overlay")).toBeVisible();
      const m = page.getByTestId("drop-marker");
      await expect(m).toHaveAttribute("data-index", "3");
      const mb = (await m.boundingBox())!;
      markX = mb.x; markW = mb.width; markCol = (await m.getAttribute("data-col"))!;
      expect(Math.abs(mb.x - (g.gridLeft + +markCol * g.pitch))).toBeLessThan(1.5);
      expect(Math.abs(mb.width - widthOf(g, 3))).toBeLessThan(1.5);
    });
    await expect.poll(() => order(page)).toEqual(["it_1x1", "it_1x2", "it_1x4", "it_1x3", "it_1x5"]);
    g = await geo(page);
    const moved = g.stories.find((x) => x.id === id)!;
    expect(Math.abs(moved.x - markX)).toBeLessThan(1.5);
    expect(Math.abs(moved.w - markW)).toBeLessThan(1.5);
    expect(moved.col).toBe(+markCol);
    await expect.poll(() => refits(page)).toBeGreaterThan(r0);
    await expectGlued(page, id);
    await shot(page, `zoom-${target}-dropped`);

    // resize: right edge two columns narrower, the pointer delta converted through the current zoom
    const hE = page.getByTestId("handle-e");
    await hE.scrollIntoViewIfNeeded();
    g = await geo(page);
    const h = await centre(hE);
    const deltaPx = -2 * g.pitch - 3; // screen px
    const expected = 3 + Math.round(deltaPx / g.zoom / g.pitchCss);
    expect(expected).toBe(1);
    await dragTo(page, h, { x: h.x + deltaPx, y: h.y });
    await expect.poll(async () => (await geo(page)).stories.find((x) => x.id === id)!.span).toBe(expected);
    g = await geo(page);
    expect(Math.abs(g.stories.find((x) => x.id === id)!.w - widthOf(g, 1))).toBeLessThan(1.01);
    await expectGlued(page, id);
    await settle(page);
    const doc = await expectValid(request, "pg_front");
    expect(doc.items.map((i: any) => i.id)).toEqual(["it_1x1", "it_1x2", "it_1x4", "it_1x3", "it_1x5"]);
    expect(doc.items[3].span).toBe(1);
    await shot(page, `zoom-${target}-resized`);

    // Fit keeps the selection, the handles stay on the block and the page fits the stage width
    await page.getByRole("button", { name: "Fit" }).click();
    await expect(blk(page, id)).toHaveAttribute("aria-pressed", "true");
    await expectGlued(page, id);
    await expect.poll(async () => {
      const pb = (await page.locator(".page").boundingBox())!, st = (await stage.boundingBox())!;
      return pb.width <= st.width - 16 + 1 && pb.width > st.width - 16 - 40;
    }).toBe(true);
  });
}
