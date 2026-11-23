import { createHash } from "node:crypto";
import sharp from "sharp";
import { defaultFocalPoint, type Focal } from "./focal.js";

export const THUMB_PX = 400;
export const WEB_PX = 1600;
export const MAX_BYTES = 40 * 1024 * 1024;

export type AssetKind = "original" | "thumb" | "web" | "cutout";
export interface AssetFile { kind: AssetKind; key: string; bytes: Buffer; contentType: string; width: number; height: number }
export interface AssetMeta {
  hash: string;           // sha256 hex of the untouched original bytes
  format: string;         // jpeg | png | webp | ...
  px: [number, number];   // width, height after EXIF orientation
  dpi: number | null;     // from file metadata, null when unknown
  hasAlpha: boolean;
  focal: Focal;           // [x, y] 0-1; default centre unless smartFocal
  orientationFixed: boolean;
}
export interface IngestResult { meta: AssetMeta; files: AssetFile[] }
export interface IngestOptions {
  paper: string;
  date: string;           // yyyy-mm-dd
  smartFocal?: boolean;   // rule-based attention default; centre otherwise
}

const EXT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif", tiff: "tif", avif: "avif" };
const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", tif: "image/tiff", avif: "image/avif" };

/** Write-once key: {paper}/{yyyy-mm-dd}/{kind}/{hash}.{ext}. */
export function assetKey(paper: string, date: string, kind: string, hash: string, ext: string): string {
  if (!/^[a-z0-9_-]+$/i.test(paper)) throw new Error("bad paper id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be yyyy-mm-dd");
  return `${paper}/${date}/${kind}/${hash}.${ext}`;
}

export const contentHash = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Type sniff by decoding the header. Throws on non-images. */
export async function sniffImage(bytes: Buffer): Promise<{ format: string; ext: string }> {
  const m = await sharp(bytes, { failOn: "error" }).metadata();
  const ext = m.format ? EXT[m.format] : undefined;
  if (!m.format || !ext) throw new Error(`unsupported image type: ${m.format ?? "unknown"}`);
  return { format: m.format, ext };
}

/**
 * Ingest one image. The print file is the untouched original; thumb (400 px) and web (1600 px)
 * are WebP, orientation fixed and converted to sRGB. Nothing is written: the caller stores the
 * returned buffers under their keys, skipping any key that already exists (duplicates are stored once).
 */
export async function ingestImage(bytes: Buffer, opts: IngestOptions): Promise<IngestResult> {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("image empty or over the size cap");
  const { format, ext } = await sniffImage(bytes);
  const hash = contentHash(bytes);
  const meta0 = await sharp(bytes).metadata();
  const swap = (meta0.orientation ?? 1) >= 5;
  const w0 = swap ? meta0.height! : meta0.width!;
  const h0 = swap ? meta0.width! : meta0.height!;

  const base = () => sharp(bytes, { failOn: "error" }).rotate().toColorspace("srgb");
  const derive = async (kind: "thumb" | "web", maxPx: number): Promise<AssetFile> => {
    const { data, info } = await base()
      .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
      .webp({ quality: kind === "thumb" ? 72 : 80, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { kind, key: assetKey(opts.paper, opts.date, kind, hash, "webp"), bytes: data, contentType: "image/webp", width: info.width, height: info.height };
  };
  const [thumb, web] = await Promise.all([derive("thumb", THUMB_PX), derive("web", WEB_PX)]);
  const original: AssetFile = { kind: "original", key: assetKey(opts.paper, opts.date, "original", hash, ext), bytes, contentType: MIME[ext], width: w0, height: h0 };
  const focal: Focal = opts.smartFocal ? await defaultFocalPoint(bytes) : [0.5, 0.5];
  return {
    meta: { hash, format, px: [w0, h0], dpi: meta0.density ?? null, hasAlpha: !!meta0.hasAlpha, focal, orientationFixed: swap || (meta0.orientation ?? 1) > 1 },
    files: [original, thumb, web],
  };
}

export interface DownloadOptions { maxBytes?: number; timeoutMs?: number; fetchImpl?: typeof fetch }
/** Download an original: follows redirects, enforces a size cap while streaming, sniffs the type. */
export async function downloadImage(url: string, o: DownloadOptions = {}): Promise<Buffer> {
  const max = o.maxBytes ?? MAX_BYTES;
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) image URLs");
  const res = await (o.fetchImpl ?? fetch)(u, { redirect: "follow", signal: AbortSignal.timeout(o.timeoutMs ?? 20000) });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new Error("image over the size cap");
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
    n += c.length;
    if (n > max) throw new Error("image over the size cap");
    chunks.push(Buffer.from(c));
  }
  const buf = Buffer.concat(chunks);
  await sniffImage(buf);
  return buf;
}
