// Test helper: serves fixtures/demo-site on 127.0.0.1:8190 inside a container's own network,
// because the site's pages link to http://127.0.0.1:8190/... and the host firewall does not let containers reach the host.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = "/site";
const types = { html: "text/html", xml: "application/xml", css: "text/css", jpg: "image/jpeg", txt: "text/plain" };
const hooks = [];
http.createServer(async (req, res) => {
  // test webhook receiver: POST /hook keeps what it got, GET /__hooks shows it
  if (req.method === "POST" && req.url === "/hook") {
    let body = ""; for await (const c of req) body += c;
    hooks.push({ headers: req.headers, body });
    res.writeHead(200).end("ok"); return;
  }
  if (req.url === "/__hooks") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(hooks)); return; }
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const abs = path.resolve(root, "." + p);
  if (!abs.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const b = await readFile(abs);
    res.writeHead(200, { "content-type": types[abs.split(".").pop()] ?? "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("not found"); }
}).listen(8190, "127.0.0.1", () => console.log("demo site on 127.0.0.1:8190"));
