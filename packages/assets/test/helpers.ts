import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const site = fileURLToPath(new URL("../../../fixtures/demo-site/", import.meta.url));
export const demo = (slug: string) => readFileSync(join(site, "img", `${slug}.jpg`));

// Same figure geometry as scripts/build-fixtures.ts 'boat' image, drawn alone to get the true mask.
export const FIG = `<circle cx="600" cy="230" r="62"/><path d="M520 310 h160 q40 0 50 50 l30 200 h-60 l-20 -120 v300 h-80 v-180 h-20 v180 h-80 v-300 l-20 120 h-60 l30 -200 q10 -50 50 -50z"/>`;
const svg = (bg: string, fg: string, W: number, H: number, fig = FIG) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 1200 800" preserveAspectRatio="none">${bg}<g fill="${fg}">${fig}</g></svg>`;

export async function truthMask(W: number, H: number): Promise<Uint8Array> {
  const buf = await sharp(Buffer.from(svg("", "#fff", W, H))).flatten({ background: "#000" }).greyscale().raw().toBuffer();
  return Uint8Array.from(buf, (v) => (v > 127 ? 1 : 0));
}
/** Synthetic scene with a known mask and a vertical-gradient background. */
export async function synthetic(W: number, H: number, jpeg = true): Promise<Buffer> {
  const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe2f0"/><stop offset="1" stop-color="#e9eef1"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/>`;
  const s = sharp(Buffer.from(svg(bg, "#7a3b2e", W, H)));
  return jpeg ? s.jpeg({ quality: 85 }).toBuffer() : s.png().toBuffer();
}
export function iou(alpha: Uint8Array, truth: Uint8Array): number {
  let i = 0, u = 0;
  for (let k = 0; k < truth.length; k++) {
    const a = alpha[k] >= 128 ? 1 : 0, t = truth[k];
    if (a && t) i++;
    if (a || t) u++;
  }
  return u ? i / u : 0;
}
