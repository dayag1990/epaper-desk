// Shared helpers for the Tamil demo photo collector. Network use: Wikimedia Commons API and Openverse API only.
import fs from "node:fs";

export const UA = "EPaperDeskDemo/0.1 (free-licence photo demo; no contact)";
export const ASSET_DIR = "/srv/epaper/demo-assets/ta/photos";
export const WORK_DIR = "/srv/epaper/demo-assets/ta/work";
export const SECTIONS = ["front", "tamil-nadu", "chennai", "india", "world", "business", "sport", "cinema"];

let last = 0;
export async function polite(url, opts = {}, { minGap = 1100, retries = 6 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const wait = last + minGap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(120000), ...opts, headers: { "User-Agent": UA, ...(opts.headers || {}) } });
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`HTTP ${res.status} for ${url}`);
      const ra = Number(res.headers.get("retry-after")) || 0;
      await new Promise((r) => setTimeout(r, Math.max(ra * 1000, 5000 * 2 ** attempt)));
      continue;
    }
    return res;
  }
}
export async function getJson(url) {
  const res = await polite(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export const stripHtml = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

// Licence policy: CC0, public domain, CC BY, CC BY-SA only.
export function classifyLicence(short, url = "") {
  const s = String(short || "").trim();
  if (!s) return { ok: false, reason: "licence-missing" };
  if (/\b(NC|ND)\b|non-?commercial|no-?deriv|all rights reserved|fair use|GFDL|free art|copyrighted|unknown|\bOGL\b|attribution only/i.test(s) && !/^CC BY(-SA)? /.test(s))
    return { ok: false, reason: "licence-not-allowed" };
  if (/^CC0\b/i.test(s) || /^CC[ -]?Zero/i.test(s)) return { ok: true, family: "CC0" };
  if (/^(Public domain|PD[ -]|PD$|Public Domain Mark)/i.test(s)) return { ok: true, family: "PD" };
  if (/^CC BY-SA[ -]\d/i.test(s)) return { ok: true, family: "CC BY-SA" };
  if (/^CC BY[ -]\d/i.test(s)) return { ok: true, family: "CC BY" };
  return { ok: false, reason: "licence-not-allowed" };
}

export function shortenCredit(creator, lic) {
  const pre = "படம்: ";
  const post = ` / Wikimedia Commons (${lic})`;
  const seg = new Intl.Segmenter("und", { granularity: "grapheme" });
  const g = [...seg.segment(creator)].map((x) => x.segment);
    let line = pre + creator + post;
  if ([...line].length <= 70 && line.length <= 70) return line;
  let n = Math.min(30, g.length);
  while (n > 1 && [...pre].length + n + 1 + [...post].length > 70) n--;
  return pre + g.slice(0, n).join("").trimEnd() + "…" + post;
}

export const readJson = (p, d) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

// Commons "redlink" user links (user page not created) -> plain /wiki/User: link.
export function cleanCreatorUrl(u) {
  if (!u) return u;
  const m = /[?&]title=(User:[^&]+)/.exec(u);
  return m && /redlink=1|action=edit/.test(u) ? `https://commons.wikimedia.org/wiki/${m[1]}` : u;
}
