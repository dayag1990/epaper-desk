// Build numbered contact sheets (thumbnails only, kept outside git) for manual visual review of a shortlist.
// usage: node sheets.mjs shortlist.json outdir
import fs from "node:fs";
import sharp from "sharp";
import { polite, readJson } from "./lib.mjs";
const [list, outdir] = process.argv.slice(2);
const items = readJson(list, []);
fs.mkdirSync(outdir, { recursive: true });
const W = 360, H = 240, COLS = 5, ROWS = 4, PER = COLS * ROWS;
const cache = `${outdir}/thumbs`; fs.mkdirSync(cache, { recursive: true });
async function thumb(f, n) {
  const p = `${cache}/${n}.jpg`;
  if (fs.existsSync(p)) return fs.readFileSync(p);
  const res = await polite(f.thumburl, {}, { minGap: 700 });
  if (!res.ok) throw new Error("thumb " + res.status);
  const b = Buffer.from(await res.arrayBuffer()); fs.writeFileSync(p, b); return b;
}
for (let s = 0; s * PER < items.length; s++) {
  const comps = [];
  for (let k = 0; k < PER && s * PER + k < items.length; k++) {
    const idx = s * PER + k, f = items[idx];
    let img;
    try {
      const b = await thumb(f, idx);
      img = await sharp(b).resize(W, H, { fit: "contain", background: "#222" }).jpeg().toBuffer();
    } catch (e) { img = await sharp({ create: { width: W, height: H, channels: 3, background: "#800" } }).jpeg().toBuffer(); }
    const x = (k % COLS) * W, y = Math.floor(k / COLS) * H;
    comps.push({ input: img, left: x, top: y });
    const svg = `<svg width="90" height="34"><rect width="90" height="34" fill="#000" fill-opacity="0.75"/><text x="6" y="26" font-size="26" fill="#ff0" font-family="sans-serif">${idx}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y });
  }
  await sharp({ create: { width: COLS * W, height: ROWS * H, channels: 3, background: "#000" } }).composite(comps).jpeg({ quality: 80 }).toFile(`${outdir}/sheet-${String(s).padStart(2, "0")}.jpg`);
  console.log("sheet", s);
}
