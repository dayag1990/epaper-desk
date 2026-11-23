import sharp from "sharp";
import { prisma } from "../db.js";
import { storeFile, type JobCtx } from "../ctx.js";
import type { Envelope } from "../main.js";

const MAX_BYTES = 25 * 1024 * 1024;

/** Fetch one picture into the files store (the original is kept untouched) and record its size. Same address twice = same asset. */
export async function fetchAsset(paper_id: string, p: { article_id?: string | null; asset_id: string; src: string; caption?: string | null; credit?: string | null }) {
  const have = await prisma.asset.findUnique({ where: { paper_id_asset_id: { paper_id, asset_id: p.asset_id } } });
  if (have?.status === "ready" && have.src_url === p.src) return have;
  const res = await fetch(p.src, { headers: { "user-agent": "EPaperDesk/0.1", accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`The picture at ${new URL(p.src).host} answered with error ${res.status}.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("That picture is too big (over 25 MB).");
  const meta = await sharp(buf).metadata();
  const ext = meta.format === "jpeg" ? "jpg" : meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : null;
  if (!ext || !meta.width || !meta.height) throw new Error("That file is not a JPEG, PNG or WebP picture.");
  const f = await storeFile(paper_id, "original", ext, buf);
  const thumb = await storeFile(paper_id, "thumb", "webp", await sharp(buf).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
  const data = { article_id: p.article_id ?? null, src_url: p.src, orig_key: f.key, w: meta.width, h: meta.height, hash: f.hash, status: "ready", error: null, derivatives: { "800": thumb.key } as any, caption: p.caption ?? null, credit: p.credit ?? null };
  return prisma.asset.upsert({ where: { paper_id_asset_id: { paper_id, asset_id: p.asset_id } }, create: { paper_id, asset_id: p.asset_id, kind: "photo", ...data }, update: data });
}

export async function assetFetch(e: Envelope, job: JobCtx) {
  try {
    await fetchAsset(e.paper_id, e.payload as any);
  } catch (err) {
    if (job.final) await prisma.asset.upsert({ where: { paper_id_asset_id: { paper_id: e.paper_id, asset_id: e.payload.asset_id } }, create: { paper_id: e.paper_id, asset_id: e.payload.asset_id, src_url: e.payload.src, status: "failed", error: (err as Error).message }, update: { status: "failed", error: (err as Error).message } }).catch(() => {});
    throw err;
  }
}
