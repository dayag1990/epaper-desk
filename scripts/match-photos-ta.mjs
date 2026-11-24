#!/usr/bin/env node
// Attach a free-licence photo (from photo-credits.json) to each Tamil demo article that has an image_hint.
// The pairing below is by hand, closest subject first: the photos are real places and objects from Commons,
// not pictures of the invented stories, so captions are neutral file-photo captions plus the credit line.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "demo-site-ta");
const MAP = {
  "ta-001": "ph-021", "ta-002": "ph-015", "ta-003": "ph-010", "ta-004": "ph-002", "ta-005": "ph-014",
  "ta-006": "ph-017", "ta-008": "ph-040", "ta-009": "ph-019", "ta-010": "ph-030", "ta-011": "ph-020",
  "ta-013": "ph-038", "ta-014": "ph-039", "ta-016": "ph-088", "ta-017": "ph-018", "ta-019": "ph-045",
  "ta-021": "ph-097", "ta-022": "ph-102", "ta-024": "ph-012", "ta-025": "ph-095", "ta-026": "ph-096",
  "ta-027": "ph-029", "ta-029": "ph-043", "ta-031": "ph-052", "ta-032": "ph-057", "ta-034": "ph-054",
  "ta-035": "ph-062", "ta-036": "ph-073", "ta-037": "ph-076", "ta-039": "ph-071",
};
const photos = new Map(JSON.parse(readFileSync(join(root, "photo-credits.json"), "utf8")).photos.map((p) => [p.id, p]));
const f = join(root, "articles.ta.json");
const data = JSON.parse(readFileSync(f, "utf8"));
const used = new Set();
for (const a of data.articles) {
  const pid = MAP[a.id];
  if (!pid) { a.image_file = null; continue; }
  const p = photos.get(pid);
  if (!p) throw new Error(`no photo ${pid}`);
  if (used.has(pid)) throw new Error(`photo ${pid} used twice`);
  used.add(pid);
  a.image_file = p.file; a.photo_id = pid;
  a.caption = `கோப்புப் படம் · படம்: ${p.creator}, ${p.licence_short}, Wikimedia Commons`;
}
writeFileSync(f, JSON.stringify(data, null, 2) + "\n");
console.log(`${used.size} articles now have a photo`);
