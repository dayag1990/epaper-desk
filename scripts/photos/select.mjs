// Apply manual visual-review rejects (visual-rejects.txt: "<shortlist-index> <reason>") and pick the download set -> selected.json
import fs from "node:fs";
import { WORK_DIR, readJson, writeJson } from "./lib.mjs";
const list = readJson(`${WORK_DIR}/shortlist.json`);
const rej = new Map(fs.readFileSync(`${WORK_DIR}/visual-rejects.txt`, "utf8").trim().split("\n").map((l) => { const [i, ...r] = l.split(" "); return [Number(i), r.join(" ")]; }));
const tally = {}; for (const r of rej.values()) tally[r] = (tally[r] || 0) + 1;
const kept = list.filter((_, i) => !rej.has(i));
const MAX = Number(process.argv[2] || 130);
const big = (f) => Math.max(f.width, f.height) >= 3840;
const must = kept.filter((f) => ["sport","cinema","chennai","tamil-nadu"].some((s) => f.sections.includes(s)));
const rest = kept.filter((f) => !must.includes(f)).sort((a, b) => big(b) - big(a) || b.width * b.height - a.width * a.height);
const sel = [...must, ...rest].slice(0, MAX);
const cnt = {}; for (const f of sel) for (const s of f.sections) cnt[s] = (cnt[s] || 0) + 1;
writeJson(`${WORK_DIR}/selected.json`, sel.map((f) => f.title));
writeJson(`${WORK_DIR}/visual-reject-tally.json`, { total: rej.size, tally });
console.log("shortlist", list.length, "visual rejects", rej.size, "kept", kept.length, "selected", sel.length, cnt, "big", sel.filter(big).length);
console.log(tally);
