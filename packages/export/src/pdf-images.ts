import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";

export interface ScreenImageOptions {
  /** Longest edge, in pixels, of every picture in the screen PDF. Smaller pictures are left at their size. */
  max_edge: number;
  /** JPEG quality, 1-100. */
  quality: number;
}
/** Screen PDF pictures: about 1280 px on the long edge at quality 75 is sharp on a phone and keeps a 40-photo edition well under 15 MB. */
export const SCREEN_IMAGES: ScreenImageOptions = { max_edge: 1280, quality: 75 };

export interface ImageReport {
  images: number;
  recompressed: number;
  bytes_before: number;
  bytes_after: number;
}

const num = (v: unknown): number | undefined => (v instanceof PDFNumber ? v.asNumber() : undefined);
const name = (v: unknown): string | undefined => (v instanceof PDFName ? v.decodeText() : undefined);

/** Number of colour components of an image's /ColorSpace (device spaces and ICCBased), or undefined when it is something else. */
function components(doc: PDFDocument, cs: unknown): number | undefined {
  const c = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  const n = name(c);
  if (n === "DeviceRGB") return 3;
  if (n === "DeviceGray") return 1;
  if (c instanceof PDFArray && name(c.lookup(0)) === "ICCBased") {
    const prof = c.lookup(1);
    const dict = (prof as { dict?: PDFDict })?.dict;
    return num(dict?.lookup(PDFName.of("N")));
  }
  return undefined;
}

/**
 * Chromium writes every photo that it had to crop (object-fit: cover) as raw, deflated pixels at the full pixel size of the
 * cropped part: a 5000 px original is 16 MB on one page. This reads each such picture back, scales it to `max_edge` and stores it
 * as a JPEG (DCTDecode). Pictures with transparency, masks, a decode array or a prediction filter, and anything that would
 * not get smaller, are left exactly as they are. Text, fonts and every other object are untouched.
 */
export async function recompressPdfImages(pdf: Uint8Array | Buffer, opts: ScreenImageOptions = SCREEN_IMAGES): Promise<{ bytes: Buffer; report: ImageReport }> {
  const sharp = (await import("sharp")).default;
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const report: ImageReport = { images: 0, recompressed: 0, bytes_before: 0, bytes_after: 0 };
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (name(d.lookup(PDFName.of("Subtype"))) !== "Image") continue;
    const w = num(d.lookup(PDFName.of("Width"))), h = num(d.lookup(PDFName.of("Height")));
    const before = obj.getContents().length;
    report.images++;
    report.bytes_before += before;
    report.bytes_after += before;
    if (!w || !h) continue;
    const filter = name(d.lookup(PDFName.of("Filter")));
    if (filter !== "FlateDecode" && filter !== "DCTDecode") continue; // anything else is not touched
    if (d.has(PDFName.of("SMask")) || d.has(PDFName.of("Mask")) || d.has(PDFName.of("Decode")) || d.has(PDFName.of("DecodeParms"))) continue;
    if (num(d.lookup(PDFName.of("BitsPerComponent"))) !== 8) continue;
    const ch = components(doc, d.get(PDFName.of("ColorSpace")));
    if (ch !== 1 && ch !== 3) continue;
    let src: ReturnType<typeof sharp>;
    if (filter === "DCTDecode") {
      src = sharp(obj.getContents()); // a JPEG Chromium passed through as it was
    } else {
      let raw: Buffer;
      try { raw = inflateSync(obj.getContents()); } catch { continue; }
      if (raw.length !== w * h * ch) continue;
      src = sharp(raw, { raw: { width: w, height: h, channels: ch } });
    }
    let jpg = src;
    if (Math.max(w, h) > opts.max_edge) jpg = jpg.resize({ width: opts.max_edge, height: opts.max_edge, fit: "inside", kernel: "lanczos3" });
    let out: { data: Buffer; info: { width: number; height: number } };
    try { out = await jpg.jpeg({ quality: opts.quality, mozjpeg: true }).toBuffer({ resolveWithObject: true }); } catch { continue; }
    if (out.data.length >= before) continue;
    const nd = d.clone(doc.context);
    nd.set(PDFName.of("Width"), PDFNumber.of(out.info.width));
    nd.set(PDFName.of("Height"), PDFNumber.of(out.info.height));
    nd.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
    nd.set(PDFName.of("Length"), PDFNumber.of(out.data.length));
    doc.context.assign(ref, PDFRawStream.of(nd, out.data));
    report.recompressed++;
    report.bytes_after += out.data.length - before;
  }
  return { bytes: Buffer.from(await doc.save({ useObjectStreams: false })), report };
}
