#!/usr/bin/env node
// Shorten the invented Tamil demo stories so eight pages hold them at a readable text size:
// the lead keeps about LEAD characters, every other story about REST, never fewer than two paragraphs.
// Paragraphs are dropped from the end, never cut mid-sentence. Re-running changes nothing more.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const f = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "demo-site-ta", "articles.ta.json");
const PAGE = { 1: [1500, 800], 2: [1700, 800], 3: [1900, 850] }; // the first pages carry the most pictures
const LEAD = Number(process.argv[2] ?? 2300), REST = Number(process.argv[3] ?? 1000);
const data = JSON.parse(readFileSync(f, "utf8"));
for (const a of data.articles) {
  const [lead, rest] = PAGE[a.page] ?? [LEAD, REST];
  const cap = a.priority === 1 ? lead : rest;
  const kept = [];
  let n = 0;
  for (const p of a.body) {
    if (kept.length >= 2 && n + p.length > cap) break;
    kept.push(p); n += p.length;
  }
  a.body = kept;
}
writeFileSync(f, JSON.stringify(data, null, 2) + "\n");
console.log(data.articles.map((a) => a.body.reduce((s, p) => s + p.length, 0)).join(" "));
