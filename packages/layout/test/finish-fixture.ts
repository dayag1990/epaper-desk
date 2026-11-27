// A page that uses every piece of the newspaper finish, for the layout, export, IDML and e-paper tests (Node only).
import { deflateSync } from "node:zlib";
import { ArticleSchema, PageDocSchema, type Article, type PageDoc } from "@epaper/core";
import { join } from "node:path";
import { loadTemplate, type Template } from "../src/index.js";
import { ROOT } from "./helpers.js";

const crc = (b: Buffer): number => {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
};
/** An RGBA PNG as a data URI: a dark disc (a "person's head and shoulders") on a TRANSPARENT background, or a solid rectangle when `opaque`. */
export function cutoutPng(w = 240, h = 300, opaque = false): string {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const dx = x - w / 2, dy = y - h * 0.62;
      const inside = opaque || dx * dx + dy * dy < (w * 0.46) ** 2 || (Math.abs(dx) < w * 0.12 && y < h * 0.3);
      raw[o] = 30; raw[o + 1] = 40; raw[o + 2] = 60; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + png.toString("base64");
}

const SENT = "The council said the work would start in the spring and that the central pier would stay in place for the whole of the repair, which engineers expect to last about eleven months.";
export const paras = (n: number, tag = ""): string[] => Array.from({ length: n }, (_, i) => `${tag}${SENT} ${SENT} ${i % 2 ? SENT : ""}`.trim());

export function art(id: string, over: Partial<Article> = {}): Article {
  return ArticleSchema.parse({
    id: `art_${id}`, paper_id: "pap_demo", source_id: "src_demo", external_id: id, url: "https://example.com/" + id, lang: "en", section: "news", tags: [], priority: 50,
    headline: "H " + id, body: [{ t: "p", text: "x" }], images: [], published_at: "2026-11-27T00:00:00Z", updated_at: "2026-11-27T00:00:00Z", content_hash: "sha256:x", rev: 1, ...over,
  });
}

export interface Showcase { doc: PageDoc; template: Template; articles: Article[] }
export function showcase(opts: { template?: string; cutout?: "alpha" | "opaque" | "none" } = {}): Showcase {
  const template = loadTemplate(join(ROOT, "templates", opts.template ?? "broadsheet-en", "inner_a.json"));
  const png = opts.cutout === "opaque" ? cutoutPng(240, 300, true) : cutoutPng();
  const articles = [
    art("lead", { images: [{ asset_id: "ast_cut1", role: "lead", src: png, caption: "Councillor Maria Delaney at the bridge.", credit: "Photo: Jane Doe, Riverton Herald" }] }),
    art("photo", { images: [{ asset_id: "ast_pic2", role: "lead", src: cutoutPng(300, 200, true), caption: "The old bridge from the east bank.", credit: "Photo: Sam Lee" }] }),
  ];
  const doc = PageDocSchema.parse({
    page: { no: 2, size: "broadsheet", w_mm: 381, h_mm: 578, template: "inner_a", body_pt: 9 },
    furniture: { masthead: "", tagline: "", strip: ["NEWS", "THURSDAY, NOVEMBER 27, 2026", "PAGE 2"] },
    status: "draft", rev: 1,
    items: [
      { id: "it_lead", kind: "story", article_id: "art_lead", slot: "story_col_span-6-1", span: 6, cols: 4, hs: 1.3, dropcap: true,
        text: { kicker: "Council", head: "Council votes to repair Old Mill Bridge", sub: "A narrow 5-4 decision keeps the 1911 crossing open.", byline: "By Hannah Oakes", dateline: "Riverton, 27 Nov", body: paras(6) },
        image: { asset_id: "ast_cut1", ratio: 0.8, cutout: opts.cutout !== "none", focal: [0.5, 0.4] } },
      { id: "it_brief", kind: "story", slot: "story_col_span-2-2", span: 2, cols: 1, hs: 0.9, block: "brief", text: { kicker: "In brief", head: "Library hours", body: [SENT] } },
      { id: "it_quote", kind: "story", slot: "story_col_span-4-3", span: 4, cols: 2, block: "quote", text: { head: "We avoided a bridge that nobody wanted to pay for", sub: "Maria Delaney, councillor", body: [SENT] } },
      { id: "it_panel", kind: "story", slot: "story_col_span-4-4", span: 4, cols: 2, block: "panel", text: { kicker: "Fact box", head: "What happens next", body: paras(2) } },
      { id: "it_photo", kind: "story", article_id: "art_photo", slot: "story_col_span-5-5", span: 5, cols: 3, text: { kicker: "Photo", head: "The old bridge", byline: "By Sam Lee", dateline: "Riverton, 26 Nov", body: paras(3) },
        image: { asset_id: "ast_pic2", ratio: 2.2, cutout: false, focal: [0.5, 0.5] }, jump: { role: "to", pair: "it_cont", page: 3 } },
      { id: "it_from", kind: "story", slot: "story_col_span-3-6", span: 3, cols: 2, text: { head: "The old bridge (continued)", body: paras(2) }, jump: { role: "from", pair: "it_cont", page: 1 } },
    ],
  });
  return { doc, template, articles };
}
