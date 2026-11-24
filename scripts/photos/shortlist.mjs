// Build a ranked shortlist from filtered.json: best title-relevant (and largest) file per query. -> shortlist.json
import { WORK_DIR, readJson, writeJson } from "./lib.mjs";
const { accepted } = readJson(`${WORK_DIR}/filtered.json`);
const queries = readJson(new URL("./queries.json", import.meta.url).pathname);
const PER = Number(process.argv[2] || 1);
const words = (q) => q.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
const picked = new Set(), list = [];
for (const { q } of queries) {
  const ws = words(q);
  const c = accepted.filter((f) => f.queries.includes(q) && !picked.has(f.title)).map((f) => {
    const hay = `${f.title} ${f.objectName} ${f.desc} ${f.categories}`.toLowerCase();
    const sc = ws.length ? ws.filter((w) => hay.includes(w)).length / ws.length : 0;
    return { f, sc, big: Math.max(f.width, f.height) >= 3840 ? 1 : 0, px: f.width * f.height };
  }).filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc || b.big - a.big || b.px - a.px);
  for (const x of c.slice(0, PER)) { picked.add(x.f.title); list.push(x.f); }
}
const seenSha = new Set();
const out = list.filter((f) => !seenSha.has(f.sha1) && seenSha.add(f.sha1));
writeJson(`${WORK_DIR}/shortlist.json`, out);
const cnt = {}; for (const f of out) for (const s of f.sections) cnt[s] = (cnt[s] || 0) + 1;
console.log(out.length, cnt, "big", out.filter((f) => Math.max(f.width, f.height) >= 3840).length);
