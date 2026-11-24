#!/usr/bin/env node
// Second pass: re-open N random source_url pages (default 10) and confirm the licence on the page still matches the record.
// usage: node scripts/photos/recheck-licences.mjs [N] [seed]
import fs from "node:fs";
import { polite } from "./lib.mjs";
import { CREDITS_PATH } from "./verify-credits.mjs";

const n = Number(process.argv[2] || 10);
let seed = Number(process.argv[3] || Date.now() % 100000);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const photos = JSON.parse(fs.readFileSync(CREDITS_PATH, "utf8")).photos;
const pool = [...photos];
const pick = [];
while (pick.length < n && pool.length) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
let bad = 0;
const results = [];
for (const p of pick) {
  const html = await (await polite(p.source_url)).text();
  const host = (p.licence_url || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const ok = (host && html.includes(host)) || html.includes(p.licence_short);
  const restricted = /personality rights|image may be restricted|may be restricted/i.test(html.replace(/<script[\s\S]*?<\/script>/g, ""));
  const good = ok && !restricted;
  if (!good) bad++;
  results.push({ id: p.id, licence: p.licence_short, source_url: p.source_url, match: good });
  console.log(good ? "MATCH " : "MISMATCH", p.id, p.licence_short, p.source_url);
}
console.log(`recheck: ${results.length - bad}/${results.length} pages match the recorded licence`);
fs.writeFileSync(new URL("../../fixtures/demo-site-ta/photo-recheck.json", import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), seed: Number(process.argv[3] || 0) || undefined, results }, null, 2) + "\n");
process.exit(bad ? 1 : 0);
