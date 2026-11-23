// Apply automatic licence/content rules to candidates.json -> filtered.json (+ rejection tally).
import { WORK_DIR, readJson, writeJson, stripHtml, classifyLicence } from "./lib.mjs";

const db = readJson(`${WORK_DIR}/candidates.json`, { files: {} });
const PERSON = /\b(portrait|selfie|actor|actress|politician|minister|chief minister|prime minister|president|singer|cricketer|footballer|batsman|bowler|player|athlete|speech|rally|poses?|posing|wedding|bride|groom|couple|family|girl|boy|woman|women|man|men|lady|child|children|baby|student|sadhu|dancer|dancing|musician|professor|mr\.?|mrs\.?)\b/i;
const PERSONCAT = /(portraits?|people of|actors|actresses|politicians|cricketers|footballers|singers|ministers|chief ministers|presidents|sportspeople|men of|women of|people in|persons|dancers|musicians|film directors|brides|weddings)/i;
const MARK = /watermark|logo|signature|advertis|poster|billboard/i;
const OTHER = /jallikattu|bullfight|bull taming|nude|erotic/i;

const out = { accepted: [], tally: {} };
const rej = (f, r) => { out.tally[r] = (out.tally[r] || 0) + 1; };
for (const f of Object.values(db.files)) {
  const long = Math.max(f.width, f.height), short = Math.min(f.width, f.height);
  const artist = stripHtml(f.artistHtml);
  const lic = classifyLicence(f.licShort, f.licUrl);
  const text = `${f.title} ${f.objectName} ${f.desc}`;
  let r = null;
  if (!/^image\/(jpeg|png|tiff)$/.test(f.mime)) r = "mime-not-jpeg-png-tiff";
  else if (long < 2400) r = "too-small(<2400)";
  else if (!lic.ok) r = lic.reason;
  else if (/personality|trademark|may be restricted|restricted/i.test(f.restrictions || "") || /personality rights|image may be restricted/i.test(f.desc)) r = "restrictions-warning";
  else if (f.copyrighted && /^false$/i.test(f.copyrighted) === false && /true/i.test(f.copyrighted) && lic.family === "PD") r = "licence-ambiguous";
  else if (!artist || /^(unknown|anonymous|n\/a|see below|\?)/i.test(artist) || artist.length < 2) r = "creator-missing-or-unknown";
  else if (OTHER.test(text)) r = "excluded-topic";
  else if (PERSONCAT.test(f.categories || "") || PERSON.test(f.title)) r = "portrait-or-person";
  else if (MARK.test(f.title) || /watermark/i.test(f.categories || "")) r = "watermark-logo-poster";
  else if (long / short > 3 || short < 1200) r = "odd-aspect";
  else if (f.size > 80e6) r = "original-too-large";
  if (r) { rej(f, r); continue; }
  out.accepted.push({ ...f, creator: artist, family: lic.family });
}
writeJson(`${WORK_DIR}/filtered.json`, out);
console.log("unique files", Object.keys(db.files).length, "accepted", out.accepted.length);
console.log(out.tally);
