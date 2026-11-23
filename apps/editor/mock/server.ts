import { createServer } from "node:http";
import { MockBackend } from "./core";
import { buildSeed } from "./seed";
import { readFileSync } from "node:fs";
import { fontContentType, fontsDir, resolveFontFile } from "@epaper/layout";

const port = +(process.env.MOCK_PORT ?? 8181);
const origin = `http://127.0.0.1:${port}`;
const seed = process.env.MOCK_SEED === "ta" ? await (await import("./seed-ta")).buildTamilSeed() : buildSeed(origin);
const backend = new MockBackend(seed, origin);
const colour = (s: string) => `hsl(${[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 45% 55%)`;

const server = createServer(async (req, res) => {
  const reqOrigin = req.headers.origin ?? "*";
  res.setHeader("Access-Control-Allow-Origin", reqOrigin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-mock-user, accept");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const url = new URL(req.url ?? "/", origin);
  // the same font files the real API serves at /fonts (templates/fonts)
  const font = url.pathname.startsWith("/fonts/") ? resolveFontFile(fontsDir(), url.pathname.slice(7)) : null;
  if (font) { res.writeHead(200, { "content-type": fontContentType(font)!, "cache-control": "public, max-age=31536000, immutable" }); res.end(readFileSync(font)); return; }
  const img = /^\/mock-assets\/([\w-]+)\.svg$/.exec(url.pathname);
  if (img) {
    const id = img[1]!;
    res.writeHead(200, { "content-type": "image/svg+xml" });
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600" viewBox="0 0 2400 1600"><rect width="2400" height="1600" fill="${colour(id)}"/><circle cx="1200" cy="640" r="380" fill="rgba(255,255,255,.35)"/><text x="1200" y="1400" font-size="120" text-anchor="middle" fill="#fff" font-family="sans-serif">${id}</text></svg>`);
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  let body: unknown;
  if ((req.headers["content-type"] ?? "").includes("json") && buf.length) body = JSON.parse(buf.toString("utf8"));
  const r = backend.handle({ method: req.method ?? "GET", path: url.pathname, user: (req.headers["x-mock-user"] as string | undefined) ?? "ana", body });
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(r.status === 204 ? undefined : JSON.stringify(r.json ?? {}));
});
server.listen(port, "127.0.0.1", () => console.log(`mock api on ${origin}`));
