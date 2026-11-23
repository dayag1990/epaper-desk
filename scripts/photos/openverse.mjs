// Openverse (anonymous) -> Wikimedia Commons titles -> imageinfo from the Commons API, merged into candidates.json.
// Openverse licence must be one of cc0/pdm/by/by-sa AND the Commons extmetadata licence must pass the same policy (filter.mjs).
import { getJson, WORK_DIR, readJson, writeJson, stripHtml } from "./lib.mjs";

const OQ = [
  ["Marina Beach Chennai", ["chennai"]], ["Tamil Nadu temple gopuram", ["tamil-nadu"]], ["Chennai Central railway station", ["chennai"]],
  ["Nilgiri tea plantation", ["tamil-nadu"]], ["Cauvery river", ["tamil-nadu"]], ["Kanyakumari", ["tamil-nadu"]],
  ["Chennai metro", ["chennai"]], ["Indian railways train", ["india"]], ["Sriharikota rocket launch", ["india"]],
  ["Parliament of India building", ["india"]], ["container port cranes", ["business"]], ["cricket stadium", ["sport"]],
  ["hockey stadium", ["sport"]], ["chess board", ["sport"]], ["cinema projector", ["cinema"]], ["film camera", ["cinema"]],
  ["clapperboard", ["cinema"]], ["recording studio", ["cinema"]], ["textile mill", ["business"]], ["solar farm", ["india"]],
  ["monsoon India", ["india"]], ["airport terminal", ["world"]], ["paddy field", ["tamil-nadu"]], ["handloom weaving", ["tamil-nadu"]],
];
const db = readJson(`${WORK_DIR}/candidates.json`, { files: {}, done: {} });
db.openverse ||= {};
const titles = new Map();
for (const [q, sections] of OQ) {
  if (db.openverse[q] !== undefined) continue;
  const p = new URLSearchParams({ q, source: "wikimedia", license: "cc0,pdm,by,by-sa", page_size: "20", extension: "jpg", size: "large" });
  let j; try { j = await getJson("https://api.openverse.org/v1/images/?" + p); } catch (e) { console.error("OV FAIL", q, e.message); continue; }
  db.openverse[q] = (j.results || []).length;
  for (const r of j.results || []) {
    const m = /commons\.wikimedia\.org\/wiki\/(File:.+)$/.exec(r.foreign_landing_url || "");
    if (!m) continue;
    const t = decodeURIComponent(m[1]).replace(/_/g, " ");
    titles.set(t, { sections, ovLicense: `${r.license} ${r.license_version}`, ovId: r.id, q });
  }
  console.log("OV", db.openverse[q], q);
}
const need = [...titles.keys()].filter((t) => !db.files[t] || true);
for (let k = 0; k < need.length; k += 40) {
  const chunk = need.slice(k, k + 40);
  const p = new URLSearchParams({ action: "query", format: "json", titles: chunk.join("|"), prop: "imageinfo", iiprop: "url|size|mime|sha1|extmetadata", iiurlwidth: "480", origin: "*" });
  const j = await getJson("https://commons.wikimedia.org/w/api.php?" + p);
  for (const pg of Object.values(j.query?.pages || {})) {
    const i = pg.imageinfo?.[0]; if (!i) continue;
    const v = (k2) => i.extmetadata?.[k2]?.value;
    const meta = titles.get(pg.title) || titles.get(chunk.find((c) => c.toLowerCase() === pg.title.toLowerCase())) || { sections: [] };
    const f = (db.files[pg.title] ||= {
      title: pg.title, pageid: pg.pageid, width: i.width, height: i.height, size: i.size, mime: i.mime, sha1: i.sha1, url: i.url, thumburl: i.thumburl,
      descriptionurl: i.descriptionurl, licShort: v("LicenseShortName"), licUrl: v("LicenseUrl"), usage: v("UsageTerms"), artistHtml: v("Artist"),
      credit: stripHtml(v("Credit")), desc: stripHtml(v("ImageDescription")), objectName: stripHtml(v("ObjectName")), restrictions: v("Restrictions"),
      categories: v("Categories"), copyrighted: v("Copyrighted"), sections: [], tags: [], queries: [],
    });
    for (const s of meta.sections) if (!f.sections.includes(s)) f.sections.push(s);
    f.openverse = { license: meta.ovLicense, id: meta.ovId };
    f.queries.push("openverse:" + meta.q);
  }
}
writeJson(`${WORK_DIR}/candidates.json`, db);
console.log("files", Object.keys(db.files).length);
