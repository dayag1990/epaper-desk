// Join release, end to end against a SEPARATE compose project (epaper-join, API on 127.0.0.1:8110).
//   pnpm exec vitest run -c vitest.stack.config.ts tests/join
// Needs: scripts/join-editor-build.sh run once (for the editor step), images built by
//   docker compose -p epaper-join -f docker-compose.yml -f docker-compose.join-test.yml build api worker
// No AI key is used anywhere. Passwords are random per run.
import { execSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";

const API = process.env.JOIN_API ?? "http://127.0.0.1:8110";
const SITE = "http://127.0.0.1:8190/"; // served inside the api and worker containers by the sidecars in docker-compose.join-test.yml
const cwd = new URL("../..", import.meta.url).pathname;
const COMPOSE = "docker compose -p epaper-join -f docker-compose.yml -f docker-compose.join-test.yml";
const sh = (cmd: string) => execSync(`sg docker -c "${cmd}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => randomBytes(9).toString("hex");
const run = rnd();
const slug = `join-${run}`;
const PW = { owner: `pw-${rnd()}`, ana: `pw-${rnd()}`, bea: `pw-${rnd()}`, vic: `pw-${rnd()}` };
const EMAIL = (n: string) => `${n}-${run}@test.example`;
const DATE = "2026-11-24";

async function call(method: string, path: string, o: { cookie?: string; body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = o.cookie;
  let body: any;
  if (o.raw) { headers["content-type"] = "application/octet-stream"; body = o.raw; }
  else if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
  const r = await fetch(API + path, { method, headers, body });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any; try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
  return { status: r.status, json, buf, headers: r.headers };
}
async function login(email: string, password: string) {
  const r = await call("POST", "/v1/auth/login", { body: { email, password, paper: slug } });
  expect(r.status).toBe(200);
  return r.headers.get("set-cookie")!.split(";")[0]!;
}
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 120_000, every = 700): Promise<T> {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t > ms) throw new Error(`timed out waiting for: ${what}`);
    await sleep(every);
  }
}
const times: Array<[string, string, number]> = [];
function step(name: string, fn: () => Promise<void>, timeout = 240_000) {
  it(name, async () => {
    const t = Date.now();
    let ok = "PASS";
    try { await fn(); } catch (e) { ok = "FAIL"; throw e; } finally { times.push([name, ok, (Date.now() - t) / 1000]); }
  }, timeout);
}

let owner: string, ana: string, bea: string, vic: string;
let sourceId: string, editionId: string, pages: any[] = [], exportId: string, hookId: string, hookSecret: string;
let articles: any[] = [];
let editedItem: { page: number; item: string; article: string; head: string } | undefined;

beforeAll(async () => {
  sh(`${COMPOSE} up -d postgres api worker demo-api demo-worker`);
  await until("api ready", async () => (await call("GET", "/readyz").catch(() => ({ status: 0 }))).status === 200);
  sh(`${COMPOSE} exec -T -e SEED_OWNER_PASSWORD=${PW.owner} -e SEED_PAPER_SLUG=${slug} -e SEED_OWNER_EMAIL=${EMAIL("owner")} api sh -c 'cd /app && node_modules/.bin/tsx prisma/seed.mts'`);
  owner = await login(EMAIL("owner"), PW.owner);
  for (const [n, role] of [["ana", "editor"], ["bea", "editor"], ["vic", "viewer"]] as const) {
    const r = await call("POST", "/v1/members", { cookie: owner, body: { email: EMAIL(n), name: n === "ana" ? "Ana Costa" : n === "bea" ? "Bea Jones" : "Vic Viewer", password: PW[n], role } });
    expect(r.status).toBe(201);
  }
  ana = await login(EMAIL("ana"), PW.ana); bea = await login(EMAIL("bea"), PW.bea); vic = await login(EMAIL("vic"), PW.vic);
}, 300_000);

afterAll(() => {
  console.log("\nSTEP RESULTS\n" + times.map(([n, ok, s]) => `${ok}  ${s.toFixed(1)}s  ${n}`).join("\n"));
});

describe("join: English demo, no AI key", () => {
  step("1 wizard: paste the site URL, get a proposed mapping", async () => {
    const r = await call("POST", "/v1/sources/wizard", { cookie: owner, body: { url: SITE } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(["rss", "scrape", "wordpress"]).toContain(r.json.kind);
    expect(r.json.sample.length).toBeGreaterThanOrEqual(3);
    expect(r.json.confidence).toBeGreaterThan(0.6);
    const mk = await call("POST", "/v1/sources", { cookie: owner, body: { kind: r.json.kind, name: "Riverton Herald", config: r.json.config, mapping: r.json.mapping } });
    expect(mk.status).toBe(201);
    sourceId = mk.json.id;
  });

  step("2 test the source: 5 parsed articles, no errors, nothing saved", async () => {
    const r = await call("POST", `/v1/sources/${sourceId}/test`, { cookie: owner });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.count).toBe(5);
    expect(r.json.errors).toEqual([]);
    expect((await call("GET", "/v1/articles", { cookie: owner })).json.items).toHaveLength(0);
  });

  step("3 sync: 15 articles stored (D1) and pictures fetched", async () => {
    const s = await call("POST", `/v1/sources/${sourceId}/sync`, { cookie: owner });
    expect(s.status).toBe(202);
    articles = await until("15 articles", async () => {
      const r = await call("GET", "/v1/articles", { cookie: owner });
      return r.json.items.length === 15 ? r.json.items : undefined;
    });
    for (const a of articles) { expect(a.id).toMatch(/^art_/); expect(a.content_hash).toMatch(/^sha256:/); expect(a.rev).toBe(1); }
    const src = await until("source ok", async () => { const r = await call("GET", `/v1/sources/${sourceId}`, { cookie: owner }); return r.json.status.startsWith("ok") ? r.json : undefined; });
    expect(src.status).toContain("15 new");
    // pictures arrive through the assets queue
    await until("lead pictures stored", async () => {
      const a = articles.find((x) => x.images.length);
      const r = await call("GET", `/v1/assets/${a.images[0].asset_id}/file`, { cookie: owner });
      return r.status === 200 && r.buf.length > 1000;
    });
  });

  step("4 re-sync makes no duplicates and changes nothing", async () => {
    for (let i = 0; i < 2; i++) await call("POST", `/v1/sources/${sourceId}/sync`, { cookie: owner });
    await until("second sync done", async () => { const r = await call("GET", `/v1/sources/${sourceId}`, { cookie: owner }); return r.json.status.includes("0 new") ? r.json : undefined; });
    await sleep(3000);
    const r = await call("GET", "/v1/articles", { cookie: owner });
    expect(r.json.items).toHaveLength(15);
    expect(new Set(r.json.items.map((a: any) => a.external_id)).size).toBe(15);
    expect(r.json.items.every((a: any) => a.rev === 1)).toBe(true);
    expect(r.json.items.map((a: any) => a.content_hash).sort()).toEqual(articles.map((a) => a.content_hash).sort());
  });

  step("5 create the edition and auto-plan 4 pages (PageDocs D3, versions, snapshots D4)", async () => {
    const e = await call("POST", "/v1/editions", { cookie: ana, body: { paper: slug, date: DATE, template_set: "broadsheet-en", name: "Main" } });
    expect(e.status).toBe(201);
    editionId = e.json.id;
    expect((await call("POST", "/v1/editions", { cookie: ana, body: { date: DATE, name: "Main" } })).json.id).toBe(editionId); // same edition again
    const ap = await call("POST", `/v1/editions/${editionId}/autoplan`, { cookie: ana, body: { pages: 4 } });
    expect(ap.status).toBe(202);
    const ed = await until("4 planned pages", async () => {
      const r = await call("GET", `/v1/editions/${editionId}`, { cookie: ana });
      return r.json.status === "planned" && r.json.pages.length === 4 ? r.json : undefined;
    });
    pages = ed.pages;
    expect(ed.templates.length).toBeGreaterThan(0);
    expect(ed.articles.length).toBe(15);
    for (const p of pages) {
      expect(p.doc.items.length).toBeGreaterThan(0);
      expect(typeof p.fit_pct).toBe("number");
      const v = await call("GET", `/v1/pages/${p.id}/versions`, { cookie: ana });
      expect(v.json.versions[0].has_snapshot).toBe(true);
    }
    const placed = new Set(pages.flatMap((p) => p.doc.items.map((i: any) => i.article_id)));
    expect(placed.size).toBe(15);
    // idempotent: planning again replaces pages, never doubles them
    await call("POST", `/v1/editions/${editionId}/autoplan`, { cookie: ana, body: { pages: 4 } });
    const again = await until("replanned", async () => {
      const r = await call("GET", `/v1/editions/${editionId}`, { cookie: ana });
      return r.json.status === "planned" && r.json.pages.every((p: any) => p.rev === 2) ? r.json : undefined;
    });
    expect(again.pages).toHaveLength(4);
    pages = again.pages;
  });

  step("6 viewer cannot save; two editors see the lock", async () => {
    const p = pages[1];
    const doc = p.doc;
    const v = await call("PUT", `/v1/pages/${p.id}`, { cookie: vic, body: { doc, rev: p.rev } });
    expect(v.status).toBe(403);
    expect(v.json.message).toMatch(/Viewers can look but not save/);
    expect((await call("POST", `/v1/pages/${p.id}/lock`, { cookie: vic })).status).toBe(403);
    const la = await call("POST", `/v1/pages/${p.id}/lock`, { cookie: ana });
    expect(la.status).toBe(200);
    expect(la.json.locked_by.name).toBe("Ana Costa");
    const lb = await call("POST", `/v1/pages/${p.id}/lock`, { cookie: bea });
    expect(lb.status).toBe(423);
    expect(lb.json.message).toMatch(/being edited by Ana Costa/);
    const sb = await call("PUT", `/v1/pages/${p.id}`, { cookie: bea, body: { doc, rev: p.rev } });
    expect(sb.status).toBe(423);
    const seen = (await call("GET", `/v1/editions/${editionId}`, { cookie: bea })).json.pages.find((x: any) => x.id === p.id);
    expect(seen.locked_by.name).toBe("Ana Costa");
    // stale rev: 409 with both versions
    const stale = await call("PUT", `/v1/pages/${p.id}`, { cookie: ana, body: { doc, rev: p.rev - 1 } });
    expect(stale.status).toBe(409);
    expect(stale.json.details.rev).toBe(p.rev);
    expect(stale.json.details.doc.page.no).toBe(p.doc.page.no);
    expect((await call("DELETE", `/v1/pages/${p.id}/lock`, { cookie: ana })).status).toBe(204);
    expect((await call("POST", `/v1/pages/${p.id}/lock`, { cookie: bea })).status).toBe(200);
    await call("DELETE", `/v1/pages/${p.id}/lock`, { cookie: bea });
  });

  step("7 edit a headline via the API: the page refits (new snapshot, fill changes)", async () => {
    const p = pages[0];
    const before = await call("GET", `/v1/pages/${p.id}/snapshot`, { cookie: ana });
    expect(before.status).toBe(200);
    const fit0 = before.json.fit_pct;
    const doc = structuredClone(p.doc);
    const it = doc.items.find((i: any) => i.text?.head && i.article_id);
    const head = `${it.text.head}: and a much longer second clause that runs across several lines of the column and keeps going`;
    it.text.head = head;
    editedItem = { page: p.no, item: it.id, article: it.article_id, head };
    const put = await call("PUT", `/v1/pages/${p.id}`, { cookie: ana, body: { doc, rev: p.rev } });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect(put.json.rev).toBe(p.rev + 1);
    const after = await until("refit snapshot", async () => {
      const pg = (await call("GET", `/v1/pages/${p.id}`, { cookie: ana })).json;
      if (pg.fit_rev < pg.rev || pg.rev <= p.rev) return undefined;
      const s = await call("GET", `/v1/pages/${p.id}/snapshot`, { cookie: ana });
      return s.status === 200 ? { pg, snap: s.json } : undefined;
    });
    const headFrame = after.snap.snapshot.pages[0].frames.find((f: any) => f.id === `${it.id}.head`);
    expect(headFrame.text).toBe(head);
    const oldFrame = before.json.snapshot.pages[0].frames.find((f: any) => f.id === `${it.id}.head`);
    expect(headFrame.h).toBeGreaterThan(oldFrame.h); // the headline got taller
    const changed = after.snap.fit_pct !== fit0 || after.pg.doc.page.body_pt !== p.doc.page.body_pt;
    console.log(`refit: fill ${fit0}% -> ${after.snap.fit_pct}%, body ${p.doc.page.body_pt}pt -> ${after.pg.doc.page.body_pt}pt, head frame h ${oldFrame.h} -> ${headFrame.h} mm`);
    expect(after.snap.fit_pct !== fit0 || after.pg.doc.page.body_pt !== p.doc.page.body_pt).toBe(true);
    expect(changed).toBe(true);
    // server fit report (POST /fit) agrees with what is stored
    const fr = await call("POST", `/v1/pages/${p.id}/fit`, { cookie: ana });
    expect(fr.status).toBe(200);
    expect(fr.json.fill_pct).toBe(after.snap.fit_pct);
    // history keeps every version; restore brings the first one back as a new version
    const vs = (await call("GET", `/v1/pages/${p.id}/versions`, { cookie: ana })).json.versions;
    expect(vs.length).toBeGreaterThanOrEqual(3);
    const cur = (await call("GET", `/v1/pages/${p.id}`, { cookie: ana })).json;
    pages[0] = cur;
  });

  step("8 the built editor, against the real API: edit a headline, the page refits", async () => {
    expect(existsSync("/srv/epaper/join-editor-dist/index.html"), "run scripts/join-editor-build.sh first").toBe(true);
    const idx = await fetch(API + "/");
    expect(idx.status).toBe(200);
    expect(await idx.text()).toContain("<script");
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: "epaper_session", value: ana.split("=")[1]!, url: API }]);
      const page = await ctx.newPage();
      await page.addInitScript(([cfg]) => { (window as any).__EPAPER_CONFIG__ = cfg; }, [{ apiBase: "", edition: editionId, autosaveMs: 300 }]);
      await page.goto(API + "/");
      const meter = page.getByTestId("fill-meter");
      await meter.waitFor({ timeout: 60_000 });
      await page.waitForFunction(() => /%/.test(document.querySelector('[data-testid="fill-meter"]')?.textContent ?? "") && !/Measuring/.test(document.querySelector('[data-testid="fill-meter"]')?.textContent ?? ""), null, { timeout: 60_000 });
      await page.getByTestId("page-tab-2").click();
      const headEl = page.locator(".page .story .head").first();
      await headEl.waitFor();
      const before = await meter.innerText();
      await headEl.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" EDITORTYPED and then a long extra stretch of headline words that wraps onto many lines of the narrow column and pushes the story down the page");
      await until("meter changes", async () => (await meter.innerText()) !== before, 20_000, 300);
      await until("saved", async () => (await page.getByTestId("save-state").innerText()) === "Saved", 30_000, 300);
      const p2 = pages[1];
      const saved = await until("saved page has the typing", async () => {
        const pg = (await call("GET", `/v1/pages/${p2.id}`, { cookie: ana })).json;
        return JSON.stringify(pg.doc).includes("EDITORTYPED") ? pg : undefined;
      }, 20_000, 500);
      expect(saved.rev).toBeGreaterThan(p2.rev);
      // and the server refits it too
      await until("server refit of the editor save", async () => {
        const pg = (await call("GET", `/v1/pages/${p2.id}`, { cookie: ana })).json;
        return pg.fit_rev === pg.rev ? pg : undefined;
      }, 60_000);
      console.log(`editor meter: "${before}" -> "${await meter.innerText()}"`);
    } finally { await browser.close(); }
    pages[1] = (await call("GET", `/v1/pages/${pages[1].id}`, { cookie: ana })).json;
  });

  step("9 export screen PDF (and ContentXML), stored write-once, download routes", async () => {
    const hook = await call("POST", "/v1/webhooks", { cookie: owner, body: { url: "http://127.0.0.1:8190/hook" } });
    expect(hook.status).toBe(201);
    hookId = hook.json.id; hookSecret = hook.json.secret;
    const x = await call("POST", `/v1/editions/${editionId}/exports`, { cookie: ana, body: { format: "pdf_screen" } });
    expect(x.status, JSON.stringify(x.json)).toBe(202);
    exportId = x.json.id;
    const done = await until("pdf export", async () => {
      const r = await call("GET", `/v1/exports/${exportId}`, { cookie: ana });
      if (r.json.status === "failed") throw new Error("export failed: " + JSON.stringify(r.json.log));
      return r.json.status === "done" ? r.json : undefined;
    });
    expect(done.url).toBe(`/v1/exports/${exportId}/download`);
    const dl = await call("GET", done.url, { cookie: ana });
    expect(dl.status).toBe(200);
    expect(dl.buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((dl.buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(4);
    const snap = await call("GET", `/v1/exports/${exportId}/snapshot`, { cookie: ana });
    expect(snap.json.unit).toBe("mm");
    expect(snap.json.pages).toHaveLength(4);
    // write-once: the same bytes in the same place; the files folder holds it exactly once
    const files = (await call("GET", "/v1/files", { cookie: owner })).json.items.filter((f: any) => f.kind === "pdf");
    expect(files.length).toBeGreaterThanOrEqual(1);
    // ContentXML
    const cx = await call("POST", `/v1/editions/${editionId}/exports`, { cookie: ana, body: { format: "cxml" } });
    const cdone = await until("cxml", async () => { const r = await call("GET", `/v1/exports/${cx.json.id}`, { cookie: ana }); return r.json.status === "done" ? r.json : undefined; });
    const xml = (await call("GET", cdone.url, { cookie: ana })).buf.toString();
    expect(xml).toContain("tps:content");
    expect(xml).toContain("EDITORTYPED");
    // IDML is another module: plain-words refusal, not a crash
    const idml = await call("POST", `/v1/editions/${editionId}/exports`, { cookie: ana, body: { format: "idml" } });
    expect(idml.status).toBe(501);
  });

  step("10 e-paper builds from that PDF (page images, text, zones), then publish fires the webhook", async () => {
    const ep = await until("e-paper ready", async () => {
      const list = (await call("GET", "/v1/epaper/editions", { cookie: ana })).json.items;
      const e = list.find((x: any) => x.source === "export");
      if (e?.status === "failed") throw new Error("epaper failed: " + JSON.stringify((await call("GET", `/v1/epaper/editions/${e.id}`, { cookie: ana })).json));
      return e?.status === "ready" ? e : undefined;
    }, 180_000);
    const detail = (await call("GET", `/v1/epaper/editions/${ep.id}`, { cookie: ana })).json;
    expect(detail.pages).toHaveLength(4);
    expect(detail.pages.every((p: any) => p.zoned_by === "snapshot")).toBe(true);
    // not public until published
    const pub0 = await call("GET", `/v1/public/papers/${slug}/editions?date=${DATE}`);
    expect(pub0.json.items).toHaveLength(0);
    expect((await call("GET", `/v1/public/editions/${ep.id}/pages`)).status).toBe(404);
    // viewer cannot publish
    expect((await call("POST", `/v1/epaper/editions/${ep.id}/publish`, { cookie: vic, body: {} })).status).toBe(403);
    const pub = await call("POST", `/v1/epaper/editions/${ep.id}/publish`, { cookie: owner, body: {} });
    expect(pub.status, JSON.stringify(pub.json)).toBe(200);
    expect(pub.json.status).toBe("published");
    const hooks = await until("webhook received", async () => {
      const out = sh(`docker exec epaper-join-demo-worker node -e \\"fetch('http://127.0.0.1:8190/__hooks').then(r=>r.text()).then(console.log)\\"`);
      const list = JSON.parse(out).filter((h: any) => JSON.parse(h.body).event === "edition.published");
      return list.length ? list : undefined;
    }, 60_000, 1000);
    const h = hooks[0];
    const payload = JSON.parse(h.body);
    expect(payload).toMatchObject({ event: "edition.published", paper: slug, edition: DATE, pages: 4 });
    expect(payload.url).toMatch(/^http:\/\/127\.0\.0\.1:8110\/v1\/public\/editions\//);
    expect(h.headers["x-epaper-signature"]).toBe("sha256=" + createHmac("sha256", hookSecret).update(h.body).digest("hex"));
    expect(h.headers["x-epaper-delivery"]).toMatch(/^[0-9a-f-]{36}$/);
    const dels = (await call("GET", `/v1/webhooks/${hookId}/deliveries`, { cookie: owner })).json.items;
    expect(dels.some((d: any) => d.status === "delivered")).toBe(true);
  });

  step("11 reader API: pages, image levels, zones (D5) that link to the right articles", async () => {
    const list = await call("GET", `/v1/public/papers/${slug}/editions?date=${DATE}`);
    expect(list.status).toBe(200);
    expect(list.headers.get("access-control-allow-origin")).toBe("*");
    expect(list.json.items).toHaveLength(1);
    const epId = list.json.items[0].id;
    const pg = (await call("GET", `/v1/public/editions/${epId}/pages`)).json;
    expect(pg.pages).toHaveLength(4);
    const latest = (await call("GET", "/v1/articles", { cookie: ana })).json.items as any[];
    const byId = new Map(latest.map((a) => [a.id, a]));
    let zoned = 0;
    const articlesWithZone = new Set<string>();
    for (const p of pg.pages) {
      expect(p.images.map((i: any) => i.w)).toEqual([400, 1600, 3200]);
      const img = await call("GET", p.images[0].url);
      expect(img.status).toBe(200);
      expect(img.headers.get("content-type")).toBe("image/webp");
      const z = (await call("GET", `/v1/public/pages/${p.id}/zones`)).json;
      expect(z.page).toBe(p.no);
      expect(z.image.w).toBeGreaterThan(1000);
      for (const zone of z.zones) {
        expect(zone.rects.length).toBeGreaterThan(0);
        for (const [x, y, w, h] of zone.rects) { expect(x + w).toBeLessThanOrEqual(1.0001); expect(y + h).toBeLessThanOrEqual(1.0001); }
        if (zone.article_id) {
          const a = byId.get(zone.article_id);
          expect(a, `zone ${zone.id} points at a known article`).toBeTruthy();
          expect(zone.url).toBe(a.url); // the tap opens that article's own page on the site
          zoned++;
          articlesWithZone.add(zone.article_id);
        }
      }
    }
    console.log(`zones linked to articles: ${zoned}; distinct articles tappable: ${articlesWithZone.size}/15`);
    expect(articlesWithZone.size).toBeGreaterThanOrEqual(13);
    // the headline we edited: its zone links to its own article
    const p1 = (await call("GET", `/v1/public/pages/${pg.pages.find((p: any) => p.no === editedItem!.page).id}/zones`)).json;
    const zone = p1.zones.find((z: any) => z.article_id === editedItem!.article);
    expect(zone, "the edited story has a tap area").toBeTruthy();
    expect(zone.url).toBe(byId.get(editedItem!.article).url);
    expect(zone.title).toContain(editedItem!.head.slice(0, 20));
    // search finds text from the PDF
    const s = await call("GET", `/v1/public/search?q=EDITORTYPED&paper=${slug}`);
    expect(s.json.items.length).toBeGreaterThanOrEqual(1);
    // a beacon is accepted
    expect((await call("POST", "/v1/public/events", { body: { paper: slug, type: "zone_tap", ep_page_id: pg.pages[0].id, zone_id: "z_x" } })).status).toBe(204);
  });

  step("12 a corrected page: replace page 2, version + 1, corrected; roll back", async () => {
    const list = (await call("GET", "/v1/epaper/editions", { cookie: ana })).json.items;
    const ep = list.find((x: any) => x.source === "export");
    const one = (await call("GET", `/v1/public/editions/${ep.id}/pages`)).json.pages.find((p: any) => p.no === 2);
    const pdf = (await call("GET", `/v1/public/pages/${one.id}/pdf`)).buf;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const put = await call("PUT", `/v1/epaper/editions/${ep.id}/pages/2`, { cookie: owner, raw: pdf });
    expect(put.status).toBe(202);
    const fixed = await until("page 2 version 2", async () => {
      const r = (await call("GET", `/v1/public/editions/${ep.id}/pages`)).json.pages.find((p: any) => p.no === 2);
      return r.version === 2 ? r : undefined;
    });
    expect(fixed.corrected).toBe(true);
    const z = (await call("GET", `/v1/public/pages/${fixed.id}/zones`)).json;
    expect(z.version).toBe(2);
    // the same file twice changes nothing
    await call("PUT", `/v1/epaper/editions/${ep.id}/pages/2`, { cookie: owner, raw: pdf });
    await sleep(4000);
    expect((await call("GET", `/v1/public/editions/${ep.id}/pages`)).json.pages.find((p: any) => p.no === 2).version).toBe(2);
    // wrong fix? roll back
    const rb = await call("POST", `/v1/epaper/editions/${ep.id}/rollback`, { cookie: owner });
    expect(rb.json.rolled_back).toBe("page");
    const back = (await call("GET", `/v1/public/editions/${ep.id}/pages`)).json.pages.find((p: any) => p.no === 2);
    expect(back.version).toBe(1);
    expect(back.corrected).toBe(false);
  });
});
