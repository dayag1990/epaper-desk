#!/usr/bin/env node
// Stand-in pictures for the client's Punjabi ContentXML sample (refs 100.jpg, 101.jpg, 103.jpg, 104.jpg, adverts-1.jpg).
// The client's own image files are NOT in the repo (WAITING ON OWNER); these grey boards say so on their face, in the corner,
// so nobody mistakes them for the paper's photos. Run: node scripts/make-pa-placeholders.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
const out = new URL("../fixtures/demo-site/img/pa/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const [ref, w, h] of [["100", 1600, 1000], ["101", 1600, 1000], ["103", 1600, 1000], ["104", 1600, 1000], ["adverts-1", 1600, 900]]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#d9d9d9"/>
  <path d="M0 0L${w} ${h}M${w} 0L0 ${h}" stroke="#bdbdbd" stroke-width="6"/>
  <rect x="24" y="24" width="640" height="84" fill="#fff" opacity=".9"/>
  <text x="44" y="82" font-family="DejaVu Sans, Arial, sans-serif" font-size="40" fill="#444">PLACEHOLDER ${ref}.jpg: client photo pending</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(`${out}${ref}.jpg`);
  console.log("wrote", `${out}${ref}.jpg`);
}
