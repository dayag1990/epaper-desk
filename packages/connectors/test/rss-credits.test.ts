import { describe, it, expect } from "vitest";
import { createRssConnector, parseFeed, syncSource, MemoryArticleStore, RSS_DEFAULT_MAPPING } from "../src/index.js";
import { CTX } from "./helpers.js";

const NS = `xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"`;
const feed = (items: string) => `<?xml version="1.0"?><rss version="2.0" ${NS}><channel><title>T</title><link>http://x.test/</link>${items}</channel></rss>`;
const item = (n: number, extra: string, html = "<p>Body paragraph one is long enough.</p><p>Second paragraph here.</p>") =>
  `<item><title>Story ${n}</title><link>http://x.test/s/${n}</link><guid isPermaLink="true">http://x.test/s/${n}</guid><pubDate>Tue, 24 Nov 2026 05:30:00 GMT</pubDate><category>World</category><description>Sum ${n}.</description><content:encoded><![CDATA[${html}]]></content:encoded>${extra}</item>`;

const CAP_TA = "கோப்புப் படம் · படம்: Beckamrajeev, CC BY-SA 3.0, Wikimedia Commons";

describe("rss: the picture's caption and credit travel with the article", () => {
  it("reads <media:description> inside <media:content> (the feed's caption already holds the credit)", () => {
    const [it0] = parseFeed(feed(item(1, `<media:content url="http://x.test/img/a.jpg" medium="image" type="image/jpeg"><media:description>${CAP_TA}</media:description></media:content>`)), "http://x.test/");
    expect(it0!.image).toBe("http://x.test/img/a.jpg");
    expect(it0!.image_caption).toBe(CAP_TA);
    expect(it0!.image_credit).toBe("");
  });

  it("reads <media:credit> (with a role attribute) and an item-level <media:description>", () => {
    const [it0] = parseFeed(feed(item(2, `<media:content url="http://x.test/img/b.jpg" medium="image"/><media:description>Old Mill Bridge</media:description><media:credit role="photographer">Photo: Jane Doe, CC BY 4.0, Wikimedia Commons</media:credit>`)), "http://x.test/");
    expect(it0!.image_caption).toBe("Old Mill Bridge");
    expect(it0!.image_credit).toBe("Photo: Jane Doe, CC BY 4.0, Wikimedia Commons");
  });

  it("falls back to the <figcaption> of the story HTML", () => {
    const html = `<figure><img src="/i.jpg"><figcaption>The <b>bridge</b>  at dusk</figcaption></figure><p>Body paragraph one is long enough.</p>`;
    const [it0] = parseFeed(feed(item(3, `<media:content url="http://x.test/img/c.jpg" medium="image"/>`, html)), "http://x.test/");
    expect(it0!.image_caption).toBe("The bridge at dusk");
  });

  it("no caption in the feed: empty strings, no invented text", () => {
    const [it0] = parseFeed(feed(item(4, `<media:content url="http://x.test/img/d.jpg" medium="image"/>`)), "http://x.test/");
    expect(it0!.image_caption).toBe("");
    expect(it0!.image_credit).toBe("");
  });

  it("ends up in the article's image (D1 caption and credit) with the DEFAULT mapping, and a re-sync keeps it without a rewrite", async () => {
    const xml = feed(
      item(1, `<media:content url="http://x.test/img/a.jpg" medium="image" type="image/jpeg"><media:description>${CAP_TA}</media:description></media:content>`) +
      item(2, `<media:content url="http://x.test/img/b.jpg" medium="image"/><media:description>Old Mill Bridge</media:description><media:credit>Photo: Jane Doe, CC BY 4.0, Wikimedia Commons</media:credit>`),
    );
    const fetcher = { get: async (u: string) => ({ url: u, status: 200, contentType: "application/rss+xml", text: xml }) };
    const store = new MemoryArticleStore();
    const run = () => syncSource(createRssConnector(fetcher as never), { url: "http://x.test/rss.xml", limit: 50 } as never, undefined, CTX, store);
    const rep = await run();
    expect(rep.created).toBe(2);
    const a = store.all().find((x) => x.external_id.endsWith("/s/1"))!;
    const b = store.all().find((x) => x.external_id.endsWith("/s/2"))!;
    expect(a.images[0]).toMatchObject({ src: "http://x.test/img/a.jpg", caption: CAP_TA });
    expect(a.images[0]!.credit ?? null).toBeNull();
    expect(b.images[0]).toMatchObject({ caption: "Old Mill Bridge", credit: "Photo: Jane Doe, CC BY 4.0, Wikimedia Commons" });
    expect(RSS_DEFAULT_MAPPING["images[0].credit"]).toBe("$.image_credit");
    const again = await run();
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  });
});
