// Renders real pages (English, Tamil, Punjabi) with the layout engine in headless Chromium and writes PNGs, so a person can LOOK at them.
// Usage: pnpm tsx scripts/finish-shots.ts <outDir> <before|after>      (names: {en,ta,pa}-p{n}-{before|after}.png)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";
import type { Article } from "@epaper/core";
import { ArticleSchema } from "../packages/core/src/index.js";
import { LayoutEngine, autoPlan, formatEditionDate, loadTemplateSet } from "../packages/layout/dist/index.js";
import { ingestTamil, taTemplates } from "../tests/ta-type/lib/tamil.js";
import { punjabiArticles } from "../packages/layout/test/helpers.js";

const ROOT = new URL("../", import.meta.url).pathname;
const out = process.argv[2]!, tag = process.argv[3] ?? "after";
mkdirSync(out, { recursive: true });

async function dataUri(file: string, w = 1400): Promise<string> {
  const b = await sharp(file).rotate().resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return "data:image/jpeg;base64," + b.toString("base64");
}

async function shoot(eng: LayoutEngine, name: string, plan: Awaited<ReturnType<typeof autoPlan>>, arts: Article[], pages: number[]) {
  for (const p of plan.pages) {
    console.log(name, "p" + p.doc.page.no, p.fit.fill_pct + "%", p.fit.body_px + "px", "holes " + p.fit.hole_pct + "%", p.template.id, p.doc.items.map((i) => i.span).join("/"));
    if (!pages.includes(p.doc.page.no)) continue;
    const png = await eng.screenshot(p.doc, p.template, arts);
    writeFileSync(join(out, `${name}-p${p.doc.page.no}-${tag}.png`), png);
  }
}

const eng = await LayoutEngine.launch();
try {
  // English: the 15 fixture articles with their demo photos inlined
  const raw = JSON.parse(readFileSync(join(ROOT, "fixtures/english-15.json"), "utf8")) as { articles: unknown[] };
  const en: Article[] = [];
  for (const a of raw.articles.map((x) => ArticleSchema.parse(x))) {
    const images = [];
    for (const im of a.images) {
      const f = join(ROOT, "fixtures/demo-site/img", new URL(im.src).pathname.split("/").pop()!);
      images.push({ ...im, src: existsSync(f) ? await dataUri(f) : im.src });
    }
    en.push({ ...a, images });
  }
  const enT = loadTemplateSet(join(ROOT, "templates/broadsheet-en"));
  await shoot(eng, "en", await autoPlan(eng, en, enT, { pages: 4, date: "THURSDAY, NOVEMBER 27, 2026" }), en, [1, 2, 3]);

  // Tamil: 40 articles, real free-licence photos on the first two stories of each section
  const taAll = await ingestTamil();
  const photos = Array.from({ length: 30 }, (_, i) => `/srv/epaper/demo-assets/ta/photos/ph-${String(i + 1).padStart(3, "0")}.jpg`).filter(existsSync);
  const seen = new Map<string, number>();
  const ta: Article[] = [];
  let pi = 0;
  for (const a of taAll) {
    const n = seen.get(a.section) ?? 0; seen.set(a.section, n + 1);
    ta.push(n < 2 && photos.length ? { ...a, images: [{ asset_id: `ast_ta${pi}${a.id.slice(-6)}` as never, role: "lead", src: await dataUri(photos[pi++ % photos.length]!, 1200), caption: "படம்: மாதிரி", credit: "Photo: demo, CC BY 4.0" }] } : a);
  }
  const t = taTemplates();
  await shoot(eng, "ta", await autoPlan(eng, ta, t, { sectionPages: t[0]!.section_order, date: formatEditionDate(new Date("2026-11-27T00:00:00Z"), t[0]!) }), ta, [1, 2]);

  // Punjabi: the prototype's own SAMPLE through the broadsheet-pa set, placeholder photos inlined
  const browser = await chromium.launch();
  const pa0 = await punjabiArticles(browser);
  await browser.close();
  const pa: Article[] = [];
  let k = 0;
  const pimgs = ["100", "101", "103", "104"].map((n) => join(ROOT, "fixtures/demo-site/img/pa", n + ".jpg"));
  for (const a of pa0) pa.push(k < 6 && a.id.endsWith("n0") || a.id.endsWith("n1") ? { ...a, images: [{ asset_id: `ast_pa${k}` as never, role: "lead", src: await dataUri(pimgs[k++ % 4]!, 1200), caption: "ਮਾਡਲ ਫੋਟੋ", credit: "Photo: demo" }] } : a);
  await shoot(eng, "pa", await autoPlan(eng, pa, loadTemplateSet(join(ROOT, "templates/broadsheet-pa")), { pages: 3 }), pa, [1, 2]);
} finally {
  await eng.close();
}
