// Idempotent post-processing of photo-credits.json: recompute credit_line and clean creator_url / licence_url.
import fs from "node:fs";
import { shortenCredit, cleanCreatorUrl } from "./lib.mjs";
const p = new URL("../../fixtures/demo-site-ta/photo-credits.json", import.meta.url).pathname;
const d = JSON.parse(fs.readFileSync(p, "utf8"));
for (const x of d.photos) {
  x.credit_line = shortenCredit(x.creator, x.licence_short);
  x.creator_url = cleanCreatorUrl(x.creator_url);
  if (!x.licence_url) x.licence_url = `${x.source_url}#Licensing`;
}
fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
console.log("fixed", d.photos.length);
