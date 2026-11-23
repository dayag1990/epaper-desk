import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArticleSchema, type Article, type PageDoc, type PageItem } from "@epaper/core";
import { loadTemplate, loadTemplateSet } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "../../..");
export const tpl = (set: string, id: string) => loadTemplate(join(ROOT, "templates", set, `${id}.json`));
export const tplSet = (set: string) => loadTemplateSet(join(ROOT, "templates", set));

export function englishArticles(): Article[] {
  const raw = JSON.parse(readFileSync(join(ROOT, "fixtures/english-15.json"), "utf8")) as { articles: unknown[] };
  return raw.articles.map((a) => ArticleSchema.parse(a));
}

/** One prototype story model -> a PageItem (prototype parseCXML output shape). */
interface ProtoStory { type: string; kind: PageItem["kind"]; paras: { ptype: string; text: string }[]; img: { ref: string } | null; kicker?: { text: string } | null }
const role = (pt: string) => (/sub[-_ ]?head/i.test(pt) ? "sub" : /head/i.test(pt) ? "head" : "body");
export function protoToDocs(model: { id: string; type: string; stories: ProtoStory[] }[], tid: (n: number) => string, sizeId = "broadsheet"): PageDoc[] {
  return model.map((sec, i) => ({
    page: { no: i + 1, size: sizeId, w_mm: 381, h_mm: 578, template: tid(i), body_pt: 8.8 },
    furniture: { masthead: "", tagline: "", strip: ["", "", ""] },
    status: "draft",
    rev: 1,
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
  }));
}
