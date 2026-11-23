// Run every query in queries.json against the Commons API; write raw candidates + rejection tally to WORK_DIR.
import fs from "node:fs";
import { getJson, WORK_DIR, readJson, writeJson, stripHtml, classifyLicence } from "./lib.mjs";

const queries = readJson(new URL("./queries.json", import.meta.url).pathname, []);
const outFile = `${WORK_DIR}/candidates.json`;
const db = readJson(outFile, { done: {}, files: {} });
const LIMIT = 30;

for (const { q, sections, tags } of queries) {
  if (db.done[q]) continue;
  const p = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6",
    gsrsearch: `${q} filetype:bitmap filew:>2400`, gsrlimit: String(LIMIT), gsrsort: "relevance",
    prop: "imageinfo", iiprop: "url|size|mime|sha1|extmetadata", iiurlwidth: "480", origin: "*",
  });
  let j;
  try { j = await getJson("https://commons.wikimedia.org/w/api.php?" + p); } catch (e) { console.error("FAIL", q, e.message); continue; }
  const pages = Object.values(j.query?.pages || {});
  for (const pg of pages) {
    const i = pg.imageinfo?.[0]; if (!i) continue;
    const em = i.extmetadata || {};
    const v = (k) => em[k]?.value;
    const f = (db.files[pg.title] ||= {
      title: pg.title, pageid: pg.pageid, width: i.width, height: i.height, size: i.size, mime: i.mime, sha1: i.sha1,
      url: i.url, thumburl: i.thumburl, descriptionurl: i.descriptionurl,
      licShort: v("LicenseShortName"), licUrl: v("LicenseUrl"), usage: v("UsageTerms"),
      artistHtml: v("Artist"), credit: stripHtml(v("Credit")), desc: stripHtml(v("ImageDescription")),
      objectName: stripHtml(v("ObjectName")), restrictions: v("Restrictions"), categories: v("Categories"),
      copyrighted: v("Copyrighted"), sections: [], tags: [], queries: [],
    });
    for (const s of sections) if (!f.sections.includes(s)) f.sections.push(s);
    for (const t of tags) if (!f.tags.includes(t)) f.tags.push(t);
    f.queries.push(q);
  }
  db.done[q] = pages.length;
  console.log(pages.length, q);
  if (Object.keys(db.done).length % 10 === 0) writeJson(outFile, db);
}
writeJson(outFile, db);
console.log("files", Object.keys(db.files).length);
