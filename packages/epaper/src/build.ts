import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ZoneSetSchema, type Zone, type ZoneSet } from "@epaper/core";
import { encodeLevels, rasterise } from "./raster.js";
import { extractTextLayer, isReadable } from "./textlayer.js";
import type { BuildOptions, EditionResult, Miss, PageResult, TextPage } from "./types.js";
import { pool, run, sha256, writeIfChanged } from "./util.js";
import { zoneFromSnapshot } from "./zones-snapshot.js";
import { zoneFromTextLayer } from "./zones-text.js";

const PIPELINE = 1; // bump to invalidate cached page output
const pad = (n: number) => String(n).padStart(4, "0");

interface PageMeta { pipeline: number; page: number; image: { w: number; h: number }; widths: number[]; format: string; files: Record<string, string> }

async function exists(p: string) { try { await stat(p); return true; } catch { return false; } }

/** Rasterise, thumbnail, split and read the text of one page. Skips work already done. */
async function processPage(pdfPath: string, root: string, page: number, o: Required<Pick<BuildOptions, "widths" | "format">>, written: string[]) {
  const dir = join(root, "pages", pad(page));
  const metaPath = join(dir, "page.json");
  try {
    const meta: PageMeta = JSON.parse(await readFile(metaPath, "utf8"));
    const ok = meta.pipeline === PIPELINE && meta.format === o.format && meta.widths.join() === o.widths.join();
    if (ok && (await Promise.all(Object.keys(meta.files).map((f) => exists(join(dir, f))))).every(Boolean)) {
      const text: TextPage = JSON.parse(await readFile(join(dir, "text.json"), "utf8"));
      return { meta, text, dir };
    }
  } catch { /* not built yet */ }

  await mkdir(dir, { recursive: true });
  const files: Record<string, string> = {};
  const put = async (name: string, data: Buffer | string) => {
    await writeIfChanged(join(dir, name), data, written);
    files[name] = sha256(data);
  };

  // page PDF (kept for download)
  const tmp = join(dir, `.split-${process.pid}.pdf`);
  await run("pdfseparate", ["-f", String(page), "-l", String(page), pdfPath, tmp.replace(/\.pdf$/, "-%d.pdf")]);
  const split = tmp.replace(/\.pdf$/, `-${page}.pdf`);
  const pdfBytes = await readFile(split);
  await rm(split, { force: true });
  await put("page.pdf", pdfBytes);

  const text = await extractTextLayer(pdfPath, page);
  await put("text.json", JSON.stringify(text));

  const raw = await rasterise(pdfPath, page, Math.max(...o.widths));
  const levels = await encodeLevels(raw, o.widths, o.format);
  for (const l of levels) await put(`w${l.width}.${o.format}`, l.bytes);
  const top = levels[levels.length - 1];
  const meta: PageMeta = { pipeline: PIPELINE, page, image: { w: top.w, h: top.h }, widths: o.widths, format: o.format, files };
  await writeIfChanged(metaPath, JSON.stringify(meta, null, 1), written);
  return { meta, text, dir };
}

/**
 * Whole-edition entry point: final PDF in, tappable edition out.
 * Output is content-addressed: <outDir>/<sha256(pdf)>/ ; same PDF and options give the same files,
 * and work already done is skipped.
 */
export async function buildEdition(pdfPath: string, opts: BuildOptions): Promise<EditionResult> {
  const widths = (opts.widths ?? [400, 1600, 3200]).slice().sort((a, b) => a - b);
  const format = opts.format ?? "webp";
  const conc = Math.min(4, Math.max(1, opts.concurrency ?? 4));
  const articles = opts.articles ?? [];
  const version = opts.version ?? 1;
  const written: string[] = [];

  const bytes = await readFile(pdfPath);
  const digest = sha256(bytes);
  const root = join(opts.outDir, digest);
  await mkdir(root, { recursive: true });
  if (!(await exists(join(root, "edition.pdf")))) await copyFile(pdfPath, join(root, "edition.pdf")).then(() => written.push(join(root, "edition.pdf")));
  const pdf = join(root, "edition.pdf");

  const info = (await run("pdfinfo", [pdf])) as string;
  const pageCount = +(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
  if (!pageCount) throw new Error("pdfinfo found no pages");

  const built = await pool(Array.from({ length: pageCount }, (_, i) => i + 1), conc, (n) => processPage(pdf, root, n, { widths, format }, written));

  const snapPages = new Map((opts.snapshot?.pages ?? []).map((p) => [p.no, p]));
  const misses: Miss[] = [];
  const pages: PageResult[] = [];
  for (const b of built) {
    const no = b.meta.page;
    const readable = isReadable(b.text);
    let zones: Zone[] = [];
    let zonedBy: PageResult["zonedBy"] = "none";
    const snap = snapPages.get(no);
    if (snap) {
      zones = zoneFromSnapshot(snap, articles, { itemArticles: opts.itemArticles, minScore: opts.minScore });
      zonedBy = "snapshot";
    } else if (readable) {
      const z = zoneFromTextLayer(b.text, articles, { minScore: opts.minScore });
      zones = z.zones; misses.push(...z.misses); zonedBy = "text";
    } else {
      // OCR would go here (opts.ocr); out of scope, so the page is listed for manual zoning.
      misses.push({ page: no, title: "(whole page)", reason: opts.ocr ? "ocr not implemented" : "text layer unreadable, no snapshot" });
    }
    const set: ZoneSet = ZoneSetSchema.parse({ page: no, image: b.meta.image, version, zones });
    await writeIfChanged(join(b.dir, "zones.json"), JSON.stringify(set, null, 1), written);
    pages.push({ page: no, dir: b.dir, files: b.meta.files, zones: set, zonedBy, textReadable: readable });
  }

  // articles that got no zone anywhere are listed for manual fix
  const zonedIds = new Set(pages.flatMap((p) => p.zones.zones.map((z) => z.article_id)));
  for (const a of articles) if (!zonedIds.has(a.id)) misses.push({ page: 0, title: a.headline, reason: "article not found in any zone" });

  const stories = pages.reduce((n, p) => n + p.zones.zones.length, 0);
  const matched = pages.reduce((n, p) => n + p.zones.zones.filter((z) => z.article_id).length, 0);
  const manifest = { sha256: digest, pages: pageCount, widths, format, version, zonedBy: pages.map((p) => p.zonedBy), misses };
  await writeIfChanged(join(root, "manifest.json"), JSON.stringify(manifest, null, 1), written);

  return { sha256: digest, dir: root, pageCount, pages, misses, stats: { stories, zoned: stories, matched }, written };
}
