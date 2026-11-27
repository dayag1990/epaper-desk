import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Article, PageDoc, PageItem } from "@epaper/core";
import type { MockSeed } from "./core";
import type { Template } from "../src/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export function buildSeed(origin = ""): MockSeed {
  const dir = join(root, "templates/broadsheet-en");
  const templates = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Template);
  const tpl = (id: string) => templates.find((t) => t.id === id)!;
  const raw = JSON.parse(readFileSync(join(root, "fixtures/english-15.json"), "utf8")) as { articles: Article[] };
  const articles = raw.articles.map((a) => ({ ...a, images: a.images.map((im) => ({ ...im, src: `${origin}/mock-assets/${im.asset_id}.svg` })) }));
  const bodyPt = (t: Template) => +((t.body.start_px * t.size.w_mm) / t.canvas_px / 25.4 * 72).toFixed(3);

  // The demo pages keep their fixed 5-3-3-2-3 layout whatever the template's own slots are (the templates now plan an uneven page).
  const SLOTS = [
    { id: "story_col_span-5-1", span: 5, cols: 5, kind: "story", image: true }, { id: "story_col_span-3-2", span: 3, cols: 3, kind: "story", image: true },
    { id: "story_col_span-3-3", span: 3, cols: 3, kind: "story", image: true }, { id: "story_col_span-2-4", span: 2, cols: 2, kind: "story", image: false },
    { id: "story_col_span-3-5", span: 3, cols: 3, kind: "story", image: false },
  ] as const;
  const make = (no: number, tid: string, slotIdx: number[], arts: number[], paras: number): PageDoc => {
    const t = tpl(tid);
    const items: PageItem[] = slotIdx.map((si, n) => {
      const s = SLOTS[si]!;
      const a = articles[arts[n]!]!;
      const body = a.body.filter((b) => b.t === "p").slice(0, paras).map((b) => b.text);
      const it: PageItem = {
        id: `it_${no}x${n + 1}` as never, kind: s.kind, article_id: a.id as never, article_rev: a.rev, slot: s.id, span: s.span, cols: s.cols, hs: 1,
        text: { kicker: a.kicker ?? null, head: a.headline, sub: a.subhead ?? null, body },
      };
      if (s.image && a.images[0]) it.image = { asset_id: a.images[0].asset_id as never, ratio: 1.78, cutout: false, focal: [0.5, 0.4] };
      return it;
    });
    return { page: { no, size: "broadsheet", w_mm: t.size.w_mm, h_mm: t.size.h_mm, template: t.id, body_pt: bodyPt(t) }, furniture: { masthead: t.furniture.masthead, tagline: t.furniture.tagline, strip: [...t.furniture.strip] }, items, status: "draft", rev: 1 };
  };
  const pages = [
    { id: "pg_front", no: 1, template_id: "front_a", doc: make(1, "front_a", [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], 3) },
    { id: "pg_two", no: 2, template_id: "inner_a", doc: make(2, "inner_a", [0, 1, 2], [5, 6, 7], 2) },
    { id: "pg_three", no: 3, template_id: "inner_a", doc: make(3, "inner_a", [0, 1], [8, 10], 2) },
  ];
  return { edition: { id: "ed_demo", name: "Riverton Herald · demo edition", date: "2026-11-24" }, pages, templates, articles };
}
