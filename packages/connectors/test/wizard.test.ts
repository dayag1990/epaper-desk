import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { ArticleSchema } from "@epaper/core";
import { proposeMapping, createHtmlConnector, syncSource, MemoryArticleStore } from "../src/index.js";
import { serve, fastFetcher, CTX, type TestSite } from "./helpers.js";

const dir = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
let site: TestSite | undefined;
afterEach(async () => { await site?.close(); site = undefined; });

describe("mapping wizard, rules only", () => {
  it("maps an unseen modern site (JSON-LD, og, sitemap) with no code", async () => {
    site = await serve(dir("siteA"));
    const p = await proposeMapping(site.origin + "/", { fetcher: fastFetcher() });
    expect(p.kind).toBe("scrape");
    expect(p.discovery.sitemaps.length).toBe(1);
    expect(p.confidence).toBeGreaterThanOrEqual(0.8);
    expect(p.sample.length).toBe(4);
    const a = p.sample.find((x) => x.headline.startsWith("Harbour lights"))!;
    expect(a).toMatchObject({ byline: "Marina Quill", section: "local" });
    expect(a.body.length).toBeGreaterThanOrEqual(4);
    expect(a.images[0].src).toMatch(/\.jpg$/);
    for (const s of p.sample) expect(ArticleSchema.safeParse(s).success).toBe(true);
    // the footer and the related box must not leak into the body
    expect(a.body.some((b) => /Footer links|related/.test(b.text))).toBe(false);
  });

  it("maps a second, differently built site (tables, no meta, no feed) with no code", async () => {
    site = await serve(dir("siteB"));
    const p = await proposeMapping(site.origin + "/", { fetcher: fastFetcher() });
    expect(p.kind).toBe("scrape");
    expect(p.sample.length).toBe(4);
    expect(p.confidence).toBeGreaterThanOrEqual(0.6);
    const a = p.sample.find((x) => x.headline.startsWith("Ferry timetable"))!;
    expect(a.headline).toBe("Ferry timetable changes for the summer season");
    expect(a.body.length).toBe(5);
    expect(a.body.some((b) => /Share|Tweet|Popular/.test(b.text))).toBe(false);
    expect(p.mapping.body).toMatch(/story_text|readable:/);
  });

  it("the proposed mapping can be saved and then used by the html adapter", async () => {
    site = await serve(dir("siteB"));
    const p = await proposeMapping(site.origin + "/", { fetcher: fastFetcher() });
    const store = new MemoryArticleStore();
    const rep = await syncSource(createHtmlConnector(fastFetcher()), p.config, p.mapping, CTX, store);
    expect(rep.created).toBe(4);
    expect((await syncSource(createHtmlConnector(fastFetcher()), p.config, p.mapping, CTX, store)).unchanged).toBe(4);
  });

  it("picks the WordPress API when the site has one", async () => {
    const posts = readFileSync(dir("wp") + "/posts.json", "utf8");
    site = await serve(dir("wp"), { routes: {
      "/": () => ({ type: "text/html", body: '<html><head><link rel="https://api.w.org/" href="/wp-json/"></head><body>hi</body></html>' }),
      "/wp-json/wp/v2/posts": (h) => ({ type: "application/json", body: posts.replaceAll("HOST", h) }),
    } });
    const p = await proposeMapping(site.origin + "/", { fetcher: fastFetcher() });
    expect(p.kind).toBe("wordpress");
    expect(p.sample.length).toBe(3);
    expect(p.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("picks a feed when the site has one with full text", async () => {
    site = await serve(dir("feeds"), { routes: { "/": (h) => ({ type: "text/html", body: `<html><head><link rel="alternate" type="application/rss+xml" href="http://${h}/rss.xml"></head><body>x</body></html>` }) } });
    const p = await proposeMapping(site.origin + "/", { fetcher: fastFetcher() });
    expect(p.kind).toBe("rss");
    expect(p.sample.length).toBe(3);
  });

  it("says plainly when it finds nothing", async () => {
    site = await serve(dir("wp"), { routes: { "/": () => ({ type: "text/html", body: "<html><body><p>empty</p></body></html>" }) } });
    const p = await proposeMapping(site.origin + "/", { fetcher: fastFetcher() });
    expect(p.confidence).toBe(0);
    expect(p.notes.join(" ")).toMatch(/could not find any article links/);
  });

  it("does not read a site whose robots.txt says no", async () => {
    site = await serve(dir("siteA"), { routes: { "/robots.txt": () => ({ type: "text/plain", body: "User-agent: *\nDisallow: /\n" }) } });
    await expect(proposeMapping(site.origin + "/", { fetcher: fastFetcher() })).rejects.toThrow(/asks robots not to read/);
  });
});

const DEMO = fileURLToPath(new URL("../../../fixtures/demo-site", import.meta.url));
describe.skipIf(!existsSync(DEMO))("wizard on the stand-in demo site (port 8190)", () => {
  // the demo pages carry http://127.0.0.1:8190 inside them, so this port is fixed
  let demo: TestSite;
  beforeAll(async () => { demo = await serve(DEMO, { port: 8190 }); });
  afterAll(async () => { await demo.close(); });
  it("maps it with no code", async () => {
    const p = await proposeMapping("http://127.0.0.1:8190/", { fetcher: fastFetcher() });
    expect(p.confidence).toBeGreaterThanOrEqual(0.8);
    expect(p.sample).toHaveLength(5);
    for (const s of p.sample) {
      expect(ArticleSchema.safeParse(s).success).toBe(true);
      expect(s.body.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("html door reads headline, body and lead image from 15 demo pages on wizard defaults", async () => {
    const store = new MemoryArticleStore();
    const rep = await syncSource(createHtmlConnector(fastFetcher()), { list: ["http://127.0.0.1:8190/"], max_links: 30 }, undefined, CTX, store);
    expect(rep.rejected).toEqual([]);
    expect(store.all().length).toBe(15);
    for (const a of store.all()) {
      expect(a.headline.length).toBeGreaterThan(8);
      expect(a.body.length).toBeGreaterThanOrEqual(2);
    }
    // 10 of the 15 demo pages carry a picture; the other 5 truly have none
    const withImage = store.all().filter((a) => a.images[0]);
    expect(withImage).toHaveLength(10);
    for (const a of withImage) expect(a.images[0].src).toMatch(/^http:\/\/127\.0\.0\.1:8190\/img\//);
  });
});
