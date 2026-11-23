import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ArticleSchema, type Article, type LayoutSnapshot, type PageDoc, type PageItem } from "@epaper/core";
import { LayoutEngine, autoPlan, defaultRatio, loadTemplate, loadTemplateSet, renderPage } from "@epaper/layout";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "../../..");

/** 4 English pages: fixtures/english-15.json -> autoPlan -> snapshot. */
export async function englishSnapshot(engine: LayoutEngine): Promise<LayoutSnapshot> {
  const raw = JSON.parse(readFileSync(join(ROOT, "fixtures/english-15.json"), "utf8")) as { articles: unknown[] };
  const arts: Article[] = raw.articles.map((a) => ArticleSchema.parse(a));
  const plan = await autoPlan(engine, arts, loadTemplateSet(join(ROOT, "templates/broadsheet-en")), { pages: 4 });
  return engine.snapshot("ed_TESTEN1", plan.pages.map((p) => ({ doc: p.doc, template: p.template })), arts);
}

interface ProtoStory { type: string; kind: PageItem["kind"]; paras: { ptype: string; text: string }[]; img: { ref: string } | null; kicker?: { text: string } | null }
const role = (pt: string) => (/sub[-_ ]?head/i.test(pt) ? "sub" : /head/i.test(pt) ? "head" : "body");

/** The BlinkCMS Punjabi sample pages (the prototype's SAMPLE feed) -> prototype-pa templates -> fitted snapshot. */
export async function punjabiSnapshot(engine: LayoutEngine): Promise<LayoutSnapshot> {
  const browser = await chromium.launch();
  try {
    const pg = await browser.newPage();
    await pg.route(/^https?:/, (r) => r.abort());
    await pg.goto("file://" + join(ROOT, "epaper-desk-prototype.html"));
    await pg.waitForTimeout(300);
    const model = await pg.evaluate(() => (window as any).__api.parseCXML((globalThis as any).eval("SAMPLE"))) as { stories: ProtoStory[] }[];
    const tpl = (id: string) => loadTemplate(join(ROOT, "templates/prototype-pa", `${id}.json`));
    const docs: { doc: PageDoc; template: ReturnType<typeof tpl> }[] = [];
    for (const [i, sec] of model.entries()) {
      const template = tpl(i === 0 ? "front_a" : "inner_a");
      const base: PageDoc = {
        page: { no: i + 1, size: template.size.id, w_mm: template.size.w_mm, h_mm: template.size.h_mm, template: template.id, body_pt: 8.8 },
        furniture: { masthead: template.furniture.masthead, tagline: template.furniture.tagline, strip: template.furniture.strip },
        status: "draft", rev: 1,
        items: sec.stories.map((s, n): PageItem => {
          const it: PageItem = { id: `it_${i + 1}x${n + 1}`, kind: s.kind, slot: s.type };
          if (s.kind !== "ad") {
            it.text = {
              kicker: s.kicker?.text ?? null,
              head: s.paras.filter((p) => role(p.ptype) === "head").map((p) => p.text).join(" "),
              sub: s.paras.filter((p) => role(p.ptype) === "sub").map((p) => p.text).join(" "),
              body: s.paras.filter((p) => role(p.ptype) === "body").map((p) => p.text),
            };
          }
          if (s.img) it.image = { asset_id: `ast_${s.img.ref.replace(/\W/g, "_")}` as `ast_${string}`, ratio: 1.78, cutout: false, focal: [0.5, 0.4] };
          return it;
        }),
      };
      const r = renderPage(base, template);
      const withRatio = { ...base, items: base.items.map((it, n) => (it.image ? { ...it, image: { ...it.image, ratio: defaultRatio(it.kind, r.spans[n]!) } } : it)) };
      const fit = await engine.fit(withRatio, template);
      docs.push({ doc: fit.doc, template });
    }
    return engine.snapshot("ed_TESTPA1", docs);
  } finally {
    await browser.close();
  }
}
