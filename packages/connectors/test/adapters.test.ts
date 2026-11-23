import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { ArticleSchema } from "@epaper/core";
import {
  createRssConnector, createWordpressConnector, createHtmlConnector, syncSource, MemoryArticleStore,
  acceptPush, signBody, FetchError, parseRobots, robotsAllows, PoliteFetcher,
} from "../src/index.js";
import { serve, fastFetcher, CTX, type TestSite } from "./helpers.js";

const dir = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
let site: TestSite | undefined;
afterEach(async () => { await site?.close(); site = undefined; });

describe("rss and atom", () => {
  it("ingests RSS 2.0 with mapping only", async () => {
    site = await serve(dir("feeds"));
    const store = new MemoryArticleStore();
    const rep = await syncSource(createRssConnector(fastFetcher()), { url: site.origin + "/rss.xml" }, undefined, CTX, store);
    expect(rep.rejected).toEqual([]);
    expect(rep.created).toBe(3);
    const a = store.all().find((x) => x.external_id === "rss:feed-guid-1")!;
    expect(a).toMatchObject({ headline: "Feed story 1", byline: "Sam Feed", section: "world", subhead: "Summary 1." });
    expect(a.body.length).toBe(2);
    expect(a.published_at).toBe("2026-03-01T10:00:00Z");
    expect(ArticleSchema.safeParse(a).success).toBe(true);
    // second run: nothing written
    const again = await syncSource(createRssConnector(fastFetcher()), { url: site.origin + "/rss.xml" }, undefined, CTX, store);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
  });

  it("ingests Atom", async () => {
    site = await serve(dir("feeds"));
    const store = new MemoryArticleStore();
    const rep = await syncSource(createRssConnector(fastFetcher()), { url: site.origin + "/atom.xml" }, undefined, CTX, store);
    expect(rep.created).toBe(2);
    expect(store.all()[0]).toMatchObject({ byline: "Ada Atom", section: "sport" });
    expect(store.all()[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a\/1$/);
  });

  it("explains a non-feed in plain words", async () => {
    site = await serve(dir("siteA"));
    const rep = await syncSource(createRssConnector(fastFetcher()), { url: site.origin + "/index.html" }, undefined, CTX, new MemoryArticleStore()).catch((e) => e);
    expect(String(rep.message ?? rep)).toMatch(/not an RSS or Atom feed/);
  });
});

describe("wordpress", () => {
  it("ingests the REST API with the stock mapping, zero code", async () => {
    site = await serve(dir("wp"), { routes: { "/wp-json/wp/v2/posts": (host) => ({ type: "application/json", body: readFixture().replaceAll("HOST", host) }) } });
    const store = new MemoryArticleStore();
    const rep = await syncSource(createWordpressConnector(fastFetcher()), { base: site.origin }, undefined, { ...CTX, maps: { sections: { events: "city" } } }, store);
    expect(rep.rejected).toEqual([]);
    expect(rep.created).toBe(3);
    const a = store.all().find((x) => x.external_id === "wp:100")!;
    expect(a).toMatchObject({ headline: "Lantern festival draws record crowds", byline: "Rowan Test", section: "city", tags: ["tagone", "tagtwo"] });
    expect(a.body.map((b) => b.t)).toEqual(["p", "p", "p", "h", "quote"]);
    expect(a.images[0]).toMatchObject({ role: "lead", caption: "Invented caption" });
    expect(a.published_at).toBe("2026-03-01T10:00:00Z");
    expect(site.hits.some((h) => h.includes("_embed=1"))).toBe(true);
  });
});

const readFixture = () => readFileSync(dir("wp") + "/posts.json", "utf8");

describe("html", () => {
  it("reads one article page with the default mapping", async () => {
    site = await serve(dir("siteA"));
    const store = new MemoryArticleStore();
    const rep = await syncSource(createHtmlConnector(fastFetcher()), { pages: [site.origin + "/stories/harbour-lights-return.html"] }, undefined, CTX, store);
    expect(rep.rejected).toEqual([]);
    const a = store.all()[0];
    expect(a).toMatchObject({ headline: "Harbour lights return after a long dark winter", byline: "Marina Quill", section: "local", published_at: "2026-02-01T08:00:00+00:00" });
    expect(a.body.length).toBeGreaterThanOrEqual(4);
    expect(a.images[0].src).toMatch(/harbour-lights-return\.jpg$/);
  });

  it("reads an index page of links", async () => {
    site = await serve(dir("siteA"));
    const store = new MemoryArticleStore();
    const rep = await syncSource(createHtmlConnector(fastFetcher()), { list: [site.origin + "/"] }, undefined, CTX, store);
    expect(rep.created).toBe(4);
  });
});

describe("push", () => {
  const article = {
    external_id: "push:1", url: "https://example.org/a", lang: "en", section: "news", tags: [], priority: 50,
    headline: "Pushed headline", body: [{ t: "p", text: "Some pushed text." }], images: [{ role: "lead", src: "https://example.org/i.jpg" }],
    published_at: "2026-04-02T10:15:00-04:00", updated_at: "2026-04-02T10:15:00-04:00",
  };
  it("accepts a valid signed article once, then dedupes", async () => {
    const store = new MemoryArticleStore();
    const body = JSON.stringify(article);
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(sig).toBe(signBody(body, "s3cret"));
    const r1 = await acceptPush({ body, signature: sig }, { secret: "s3cret" }, CTX, store);
    expect(r1).toMatchObject({ ok: true, status: 201 });
    const r2 = await acceptPush({ body, signature: sig }, { secret: "s3cret" }, CTX, store);
    expect(r2).toMatchObject({ ok: true, status: 200, action: "unchanged" });
    expect(store.all()).toHaveLength(1);
  });
  it("refuses a wrong signature and an invalid body with reasons", async () => {
    const store = new MemoryArticleStore();
    const body = JSON.stringify(article);
    expect(await acceptPush({ body, signature: "sha256=00" }, { secret: "s3cret" }, CTX, store)).toMatchObject({ ok: false, status: 401 });
    const bad = await acceptPush({ body: { ...article, headline: undefined, url: "nope" } }, {}, CTX, store);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reasons.join(" ")).toMatch(/url|headline/);
    expect(store.all()).toHaveLength(0);
  });
});

describe("polite fetching", () => {
  it("sends the EPaperDesk user agent and respects robots.txt", async () => {
    let ua = "";
    site = await serve(dir("siteA"), { routes: { "/robots.txt": () => ({ type: "text/plain", body: "User-agent: *\nDisallow: /stories/\n" }) } });
    const f = new PoliteFetcher({ minIntervalMs: 0, fetchImpl: ((u: any, init: any) => { ua = init.headers["User-Agent"]; return fetch(u, init); }) as typeof fetch });
    await f.get(site.origin + "/index.html");
    expect(ua).toBe("EPaperDesk/0.1");
    const err = await f.get(site.origin + "/stories/harbour-lights-return.html").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err.code).toBe("robots_blocked");
    expect(site.hits).not.toContain("/stories/harbour-lights-return.html");
  });

  it("parses robots rules: longest match wins, EPaperDesk group beats *", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: EPaperDesk\nDisallow: /private\nAllow: /private/ok$\n");
    expect(robotsAllows(r, "/news/1")).toBe(true);
    expect(robotsAllows(r, "/private/x")).toBe(false);
    expect(robotsAllows(r, "/private/ok")).toBe(true);
  });

  it("spaces requests to one host by the rate limit", async () => {
    site = await serve(dir("feeds"));
    const waits: number[] = [];
    const f = new PoliteFetcher({ minIntervalMs: 500, respectRobots: false, sleep: async (ms) => { waits.push(ms); } });
    await f.get(site.origin + "/rss.xml");
    await f.get(site.origin + "/atom.xml");
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(0);
  });

  it("gives plain-words errors for 404, timeout and a dead host", async () => {
    site = await serve(dir("feeds"), { routes: { "/slow": () => ({ type: "text/plain", body: "x" }) } });
    const f = fastFetcher({ respectRobots: false });
    expect((await f.get(site.origin + "/missing").catch((e) => e)).message).toMatch(/nothing at \/missing/);
    const slow = new PoliteFetcher({ minIntervalMs: 0, timeoutMs: 20, respectRobots: false, fetchImpl: ((_u: any, init: any) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))) as typeof fetch });
    expect((await slow.get(site.origin + "/slow").catch((e) => e)).message).toMatch(/took too long/);
    expect((await f.get("http://127.0.0.1:1/").catch((e) => e)).message).toMatch(/could not reach/);
    expect((await f.get("ftp://x").catch((e) => e)).message).toMatch(/not a web address/);
  });
});
