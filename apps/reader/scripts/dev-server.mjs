// Builds a real edition from the fixtures with @epaper/epaper, then serves
//  :8185  reader dist + /ed/<sha>/... + /ed/latest.json + /config.json (static source), CORS open
//  :8186  a plain third-party page (embed-test.html) that carries the embed.js tag
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEdition } from "@epaper/epaper";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../..");
const dist = resolve(here, "../dist");
const PORT = +(process.env.READER_PORT ?? 8185), PORT2 = +(process.env.THIRD_PARTY_PORT ?? 8186);
const out = process.env.EDITION_DIR ?? join(tmpdir(), "epaper-reader-dev");
mkdirSync(out, { recursive: true });

const fx = JSON.parse(readFileSync(join(root, "fixtures/english-15.json"), "utf8"));
const articles = fx.articles.map((a) => ({ id: a.id, headline: a.headline, url: a.url }));
const res = await buildEdition(join(root, "fixtures/edition-24p.pdf"), { outDir: join(out, "ed"), articles });
const date = process.env.EDITION_DATE ?? "2026-11-18";
writeFileSync(join(out, "ed/latest.json"), JSON.stringify({ sha: res.sha256, paper: "riverton-herald", date, pages: res.pageCount }));
console.log(`edition ${res.sha256.slice(0, 12)} pages=${res.pageCount} matched=${res.stats.matched}/${res.stats.stories}`);

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf", ".webmanifest": "application/manifest+json" };
const cors = { "access-control-allow-origin": "*" };

function file(res, p, extra = {}) {
  if (!existsSync(p) || !statSync(p).isFile()) { res.writeHead(404, cors).end("not found"); return; }
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream", ...cors, ...extra });
  createReadStream(p).pipe(res);
}
const safe = (base, rel) => { const p = normalize(join(base, rel)); return p.startsWith(base) ? p : base; };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/config.json") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ source: "static", staticBase: "./ed", paper: "riverton-herald" }));
  } else if (path === "/__bump" && req.method === "POST") {
    // test hook: the newsroom re-exported the edition (the pointer file now says a different date)
    const f = join(out, "ed/latest.json");
    const l = JSON.parse(readFileSync(f, "utf8"));
    writeFileSync(f, JSON.stringify({ ...l, date: "2026-11-19" }));
    res.writeHead(200, { "content-type": "application/json", ...cors }).end("{}");
  } else if (path.startsWith("/ed/")) file(res, safe(join(out, "ed"), path.slice(4)));
  else file(res, safe(dist, path === "/" ? "index.html" : path.slice(1)), path === "/sw.js" ? { "cache-control": "no-cache" } : {});
}).listen(PORT, "127.0.0.1", () => console.log(`reader http://127.0.0.1:${PORT}/`));

createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/embed-test.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><meta charset=utf-8><title>Plain site</title><h1>A plain HTML page</h1><p>Before.</p>
<div data-epaper></div>
<script src="http://127.0.0.1:${PORT}/embed.js" data-paper="riverton-herald" data-edition="latest"></script>
<p>After.</p>`);
  } else res.writeHead(404).end();
}).listen(PORT2, "127.0.0.1", () => console.log(`third-party page http://127.0.0.1:${PORT2}/embed-test.html`));
