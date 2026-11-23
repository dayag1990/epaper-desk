import sharp from "sharp";
import { run } from "./util.js";

/** Rasterise one PDF page to raw RGB at `width` px (pdftoppm P6 on stdout, no temp file). */
export async function rasterise(pdfPath: string, page: number, width: number): Promise<{ data: Buffer; w: number; h: number }> {
  const ppm = (await run("pdftoppm", ["-f", String(page), "-l", String(page), "-scale-to-x", String(width), "-scale-to-y", "-1", pdfPath], true)) as Buffer;
  // P6\n<w> <h>\n255\n
  let pos = 0;
  const tok = () => {
    while (ppm[pos] === 0x20 || ppm[pos] === 0x0a || ppm[pos] === 0x0d) pos++;
    const s = pos;
    while (ppm[pos] > 0x20) pos++;
    return ppm.toString("latin1", s, pos);
  };
  if (tok() !== "P6") throw new Error("pdftoppm did not return a P6 image");
  const w = +tok(), h = +tok();
  tok();
  pos++; // single whitespace after maxval
  return { data: ppm.subarray(pos), w, h };
}

/** Encode the big raster at each width. Deterministic for the same input. */
export async function encodeLevels(
  raw: { data: Buffer; w: number; h: number },
  widths: number[],
  format: "webp" | "jpeg",
): Promise<{ width: number; w: number; h: number; bytes: Buffer }[]> {
  const out: { width: number; w: number; h: number; bytes: Buffer }[] = [];
  for (const width of widths) {
    let img = sharp(raw.data, { raw: { width: raw.w, height: raw.h, channels: 3 } });
    if (width !== raw.w) img = img.resize({ width, kernel: "lanczos3" });
    const enc = format === "webp" ? img.webp({ quality: 80 }) : img.jpeg({ quality: 82, mozjpeg: false });
    const { data, info } = await enc.toBuffer({ resolveWithObject: true });
    out.push({ width, w: info.width, h: info.height, bytes: data });
  }
  return out;
}
