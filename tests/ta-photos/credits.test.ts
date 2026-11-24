// Photo credits (owner decision): a photo licensed CC BY or CC BY-SA is credited in its caption line, in the feed, so a re-sync keeps it;
// CC0 and public domain need none. Rules live in scripts/lib/photo-credit.mjs; the captions are written by scripts/match-photos-ta.mjs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs helper
import { captionFor, cleanCreator, creditLine, needsCredit } from "../../scripts/lib/photo-credit.mjs";
import { createRssConnector, MemoryArticleStore, RSS_DEFAULT_MAPPING, syncSource } from "../../packages/connectors/src/index.js";
import { splitCaption } from "../../packages/layout/src/caption.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "fixtures/demo-site-ta");
const photos = new Map<string, { id: string; creator: string; licence_short: string }>((JSON.parse(readFileSync(join(FIX, "photo-credits.json"), "utf8")).photos as any[]).map((p) => [p.id, p]));
const arts = (JSON.parse(readFileSync(join(FIX, "articles.ta.json"), "utf8")).articles as any[]).filter((a) => a.image_file);

describe("credit rule", () => {
  it("CC BY and CC BY-SA (any version) need a credit; CC0, public domain, NC, ND and unknown do not", () => {
    for (const l of ["CC BY 2.0", "CC BY 3.0", "CC BY 4.0", "CC BY-SA 2.0", "CC BY-SA 3.0", "CC BY-SA 4.0", "CC BY-SA"]) expect(needsCredit(l), l).toBe(true);
    for (const l of ["CC0", "Public domain", "PDM", "CC BY-NC 4.0", "CC BY-ND 2.0", "CC BY-NC-SA 3.0", "", null, undefined, "All rights reserved"]) expect(needsCredit(l), String(l)).toBe(false);
  });
  it("Tamil and English wording, creator cleaned of ORCID numbers", () => {
    expect(creditLine({ creator: "Jay Sands", licence_short: "CC BY 3.0" }, "ta")).toBe("படம்: Jay Sands, CC BY 3.0, Wikimedia Commons");
    expect(creditLine({ creator: "Jay Sands", licence_short: "CC BY 4.0" }, "en")).toBe("Photo: Jay Sands, CC BY 4.0, Wikimedia Commons");
    expect(creditLine({ creator: "Nizil Shah", licence_short: "CC0" }, "ta")).toBe("");
    expect(cleanCreator("David Osipov 0000 0005 1802 960X 0009-0005-2713-9242")).toBe("David Osipov");
    expect(captionFor({ creator: "A", licence_short: "CC0" }, "ta")).toBe("கோப்புப் படம்");
    expect(captionFor({ creator: "A", licence_short: "CC BY-SA 4.0" }, "en")).toBe("File photo · Photo: A, CC BY-SA 4.0, Wikimedia Commons");
  });
});

describe("the Tamil demo photos", () => {
  it("every printed photo has a caption; BY / BY-SA photos carry their credit, CC0 and public-domain photos carry none", () => {
    expect(arts.length).toBeGreaterThanOrEqual(24);
    let credited = 0, free = 0;
    for (const a of arts) {
      const p = photos.get(a.photo_id)!;
      expect(p, a.id).toBeTruthy();
      if (needsCredit(p.licence_short)) {
        credited++;
        expect(a.caption, a.id).toBe(`கோப்புப் படம் · படம்: ${cleanCreator(p.creator)}, ${p.licence_short}, Wikimedia Commons`);
      } else {
        free++;
        expect(a.caption, a.id).toBe("கோப்புப் படம்");
      }
    }
    expect(credited).toBeGreaterThan(20);
    expect(free).toBeGreaterThanOrEqual(1);
  });

  it("the generated RSS feed carries every caption, and the connector hands it to the article's image; the page splits it into caption and credit", async () => {
    const xml = readFileSync(join(FIX, "site/rss.xml"), "utf8");
    const fetcher = { get: async (u: string) => ({ url: u, status: 200, contentType: "application/rss+xml", text: xml }) };
    const store = new MemoryArticleStore();
    await syncSource(createRssConnector(fetcher as never), { url: "http://127.0.0.1:8190/rss.xml", limit: 200 } as never, { ...RSS_DEFAULT_MAPPING, lang: "const:ta", script: "const:Taml" }, { paperId: "pap_ta", sourceId: "src_ta" } as never, store);
    const byUrl = new Map(store.all().map((x) => [x.external_id.split("/").pop()!.replace(".html", ""), x]));
    for (const a of arts) {
      const got = byUrl.get(a.id)!.images[0]!;
      expect(got.caption, a.id).toBe(a.caption);
      const parts = splitCaption(got.caption, got.credit);
      const p = photos.get(a.photo_id)!;
      expect(parts.text, a.id).toBe("கோப்புப் படம்");
      expect(parts.credit, a.id).toBe(needsCredit(p.licence_short) ? creditLine(p, "ta") : "");
    }
  });
});
