import { createServer, type ServerResponse } from "node:http";
import { MockBackend, type MockSeed } from "./core";
import { buildSeed } from "./seed";
import { readFileSync } from "node:fs";
import { fontContentType, fontsDir, resolveFontFile } from "@epaper/layout";

const port = +(process.env.MOCK_PORT ?? 8181);
const origin = `http://127.0.0.1:${port}`;
const seed = process.env.MOCK_SEED === "ta" ? await (await import("./seed-ta")).buildTamilSeed() : buildSeed(origin);
// a second paper (thenpothigai) with its own edition and pages: same layout, different ids and headlines
const second = (b: MockSeed): MockSeed => ({
  ...b,
  edition: { id: "ed_tamil", name: "Thenpothigai · demo edition", date: "2026-11-24" },
  pages: b.pages.map((p) => ({ ...p, id: p.id.replace("pg_", "pt_"), doc: { ...structuredClone(p.doc), items: p.doc.items.map((i) => ({ ...i, text: i.text ? { ...i.text, head: `தமிழ் · ${i.text.head}` } : i.text })) } })),
});
const backend = new MockBackend(seed, origin, process.env.MOCK_SEED === "ta" ? undefined : second(seed));
const colour = (s: string) => `hsl(${[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 45% 55%)`;

/** Server-Sent-Events clients: the page stream (/v1/events) and the ops desk's alert stream (/ops/alerts/stream). */
const pageStreams = new Set<ServerResponse>(), alertStreams = new Set<ServerResponse>();
const send = (set: Set<ServerResponse>, event: string, data: unknown) => { for (const r of set) r.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
let alertSeq = 0;

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
  if (url.pathname === "/v1/events" || url.pathname === "/ops/alerts/stream") {
    const alerts = url.pathname !== "/v1/events";
    if (!alerts && !backend.sseOn) { res.writeHead(404, { "content-type": "application/json" }).end("{}"); return; }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write("retry: 300\n\n");
    if (alerts) res.write(`event: snapshot\ndata: ${JSON.stringify({ recent: [], firing: [], seq: alertSeq })}\n\n`);
    (alerts ? alertStreams : pageStreams).add(res);
    req.on("close", () => (alerts ? alertStreams : pageStreams).delete(res));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  let body: unknown;
  if ((req.headers["content-type"] ?? "").includes("json") && buf.length) body = JSON.parse(buf.toString("utf8"));
  if (url.pathname === "/__other_saves" && req.method === "POST") { // another person saves a page: change it, then announce it like the real server
    const b = body as { page: string; headline: string; fill: number };
    const ev = backend.externalSave(b.page, b.headline, b.fill);
    send(pageStreams, ev.type, ev);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(ev));
    return;
  }
  if (url.pathname === "/__emit" && req.method === "POST") { const b = body as { type: string }; send(pageStreams, b.type, b); res.writeHead(200).end("{}"); return; }
  if (url.pathname === "/__alert" && req.method === "POST") {
    const b = body as { id: string; title: string; text: string; kind?: string };
    const a = { id: b.id, seq: ++alertSeq, episode: b.id.split(":")[0], kind: b.kind ?? "fired", key: "k", title: b.title, text: b.text, at: new Date().toISOString(), link: "/" };
    send(alertStreams, "alert", a); send(alertStreams, "alert", a); // twice on purpose: the screen must show it once
    res.writeHead(200).end("{}"); return;
  }
  const r = backend.handle({ method: req.method ?? "GET", path: url.pathname, user: (req.headers["x-mock-user"] as string | undefined) ?? "ana", body });
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(r.status === 204 ? undefined : JSON.stringify(r.json ?? {}));
});
server.listen(port, "127.0.0.1", () => console.log(`mock api on ${origin}`));
