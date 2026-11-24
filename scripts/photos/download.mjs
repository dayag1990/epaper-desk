// Download selected Commons originals, convert to JPEG q92 (EXIF orientation applied, sRGB), confirm licence on the File: page,
// append to fixtures/demo-site-ta/photo-credits.json. usage: node download.mjs selected.json
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { polite, UA, ASSET_DIR, WORK_DIR, readJson, writeJson, stripHtml, shortenCredit, classifyLicence, cleanCreatorUrl } from "./lib.mjs";

const CREDITS = new URL("../../fixtures/demo-site-ta/photo-credits.json", import.meta.url).pathname;
const REJ = `${WORK_DIR}/download-rejects.json`;
const PACE_MS = 8000;
const sel = readJson(process.argv[2], []);
const cands = readJson(`${WORK_DIR}/candidates.json`, { files: {} }).files;
fs.mkdirSync(ASSET_DIR, { recursive: true });
const credits = readJson(CREDITS, { photos: [] });
const rejects = readJson(REJ, {});
const STOP = new Set(["the", "of", "in", "at", "a", "and", "india", "tamil", "nadu"]);
const absUrl = (u) => (u.startsWith("//") ? "https:" + u : u.startsWith("/") ? "https://commons.wikimedia.org" + u : u);
const totalBytes = () => credits.photos.reduce((a, p) => a + p.bytes, 0);

for (const title of sel) {
  const f = cands[title];
  if (!f) { console.log("unknown", title); continue; }
  if (credits.photos.some((p) => p.commons_title === title) || rejects[title]) continue;
  if (totalBytes() > 1.9e9) { console.log("2GB cap reached"); break; }
  const fail = (r) => { rejects[title] = r; writeJson(REJ, rejects); console.log("REJECT", r, title); };

  // 1) confirm licence on the human-readable File: page
  const pageUrl = f.descriptionurl;
  const html = await (await polite(pageUrl)).text();
  const lic = classifyLicence(f.licShort, f.licUrl);
  const licHost = (f.licUrl || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const pageOk = lic.ok && ((licHost && html.includes(licHost)) || html.includes(f.licShort)) && !/personality rights|image may be restricted|may be restricted/i.test(html.replace(/<script[\s\S]*?<\/script>/g, ""));
  if (!pageOk) { fail("page-licence-unconfirmed-or-restricted"); continue; }

  // 2) download original
  // Originals are fetched with curl: upload.wikimedia.org answers 429 to Node's fetch fingerprint but not to curl.
  // On 429 we honour Retry-After (plus margin) and try again; originals are paced at >= PACE_MS apart.
  await new Promise((r) => setTimeout(r, PACE_MS));
  const tmp = `${WORK_DIR}/dl.tmp`, hdr = `${WORK_DIR}/dl.hdr`;
  let buf = null, lastErr = "";
  for (let attempt = 0; attempt < 8 && !buf; attempt++) {
    let code = "000";
    try {
      code = execFileSync("curl", ["-sS", "-m", "300", "--speed-time", "30", "--speed-limit", "20000", "-A", UA, "-D", hdr, "-o", tmp, "-w", "%{http_code}", f.url.replace(/\?.*$/, "")], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    } catch (e) { lastErr = String(e.message).slice(0, 80); }
    if (code === "200") { buf = fs.readFileSync(tmp); break; }
    const ra = Number(/retry-after:\s*(\d+)/i.exec(fs.existsSync(hdr) ? fs.readFileSync(hdr, "utf8") : "")?.[1] || 0);
    lastErr = lastErr || "HTTP " + code;
    const wait = code === "429" ? (ra || 600) + 30 : 15 * (attempt + 1);
    console.log(`  ${code} on ${title}; waiting ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!buf) { fail("download-failed " + lastErr); continue; }
  let out, meta, q = 92;
  try {
    const mk = () => sharp(buf, { limitInputPixels: false, failOn: "none" }).rotate().flatten({ background: "#ffffff" }).toColourspace("srgb");
    out = await mk().jpeg({ quality: q }).toBuffer();
    while (out.length > 25e6 && q > 70) { q -= 6; out = await mk().jpeg({ quality: q }).toBuffer(); }
    meta = await sharp(out).metadata();
  } catch (e) { fail("convert-failed " + e.message); continue; }
  const long = Math.max(meta.width, meta.height);
  if (long < 2400) { fail("too-small-after-download"); continue; }
  if (out.length > 25e6) { fail("over-25MB"); continue; }
  const sha = crypto.createHash("sha256").update(out).digest("hex");
  if (credits.photos.some((p) => p.sha256 === sha)) { fail("duplicate-sha256"); continue; }

  const id = "ph-" + String(credits.photos.length + 1).padStart(3, "0");
  const file = `${id}.jpg`;
  fs.writeFileSync(`${ASSET_DIR}/${file}`, out);
  const creator = stripHtml(f.artistHtml);
  const href = /href="([^"]+)"/.exec(f.artistHtml || "")?.[1];
  const base = (f.objectName || f.title.replace(/^File:/, "").replace(/\.\w+$/, "")).replace(/_/g, " ");
  const words = [...new Set([...f.queries.filter((x) => !x.startsWith("openverse:")).slice(0, 1).flatMap((x) => x.toLowerCase().split(/\W+/)), ...f.tags])].filter((w) => w && !STOP.has(w));
  credits.photos.push({
    id, file, width: meta.width, height: meta.height, bytes: out.length, sha256: sha,
    title: base, creator, creator_url: href ? cleanCreatorUrl(absUrl(href.replace(/&amp;/g, "&"))) : null,
    licence_short: f.licShort, licence_url: f.licUrl || `${pageUrl}#Licensing`, source_url: pageUrl, original_file_url: f.url,
    retrieved_at: new Date().toISOString(), tags: words, sections: f.sections,
    orientation: meta.width > meta.height * 1.05 ? "horizontal" : meta.height > meta.width * 1.05 ? "vertical" : "square",
    max_available: long < 3840,
    credit_line: shortenCredit(creator, f.licShort),
    commons_title: title, original_width: f.width, original_height: f.height, original_mime: f.mime,
    openverse_licence: f.openverse?.license ?? null, jpeg_quality: q, page_licence_confirmed: true,
  });
  writeJson(CREDITS, credits);
  console.log(id, meta.width + "x" + meta.height, (out.length / 1e6).toFixed(1) + "MB", f.licShort, title);
}
console.log("total", credits.photos.length, (totalBytes() / 1e6).toFixed(0) + "MB");
