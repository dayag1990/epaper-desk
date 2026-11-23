import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { PoliteFetcher } from "../src/index.js";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".xml": "application/xml", ".json": "application/json", ".txt": "text/plain", ".jpg": "image/jpeg", ".css": "text/css" };

export interface TestSite {
  origin: string;
  hits: string[];
  close(): Promise<void>;
}

/** Serve a folder on a local port. HOST in text files becomes the real host:port. Extra routes win over files. */
export async function serve(dir: string, opts: { port?: number; routes?: Record<string, (host: string) => { type: string; body: string; status?: number }>; fixedHost?: boolean } = {}): Promise<TestSite> {
  const hits: string[] = [];
  let host = "";
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    hits.push(url.pathname + url.search);
    const route = opts.routes?.[url.pathname];
    if (route) {
      const r = route(host);
      res.writeHead(r.status ?? 200, { "content-type": r.type }).end(r.body);
      return;
    }
    let p = normalize(join(dir, decodeURIComponent(url.pathname)));
    if (!p.startsWith(dir)) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(p)).isDirectory()) p = join(p, "index.html");
      const buf = await readFile(p);
      const type = TYPES[extname(p)] ?? "application/octet-stream";
      const body = type.startsWith("text/") || type.includes("xml") ? Buffer.from(buf.toString("utf8").replaceAll("HOST", host)) : buf;
      res.writeHead(200, { "content-type": type }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  await new Promise<void>((ok, bad) => { server.once("error", bad); server.listen(opts.port ?? 0, "127.0.0.1", () => ok()); });
  const port = (server.address() as { port: number }).port;
  host = `127.0.0.1:${port}`;
  return { origin: `http://${host}`, hits, close: () => new Promise((ok) => { server.close(() => ok()); server.closeAllConnections?.(); }) };
}

export const fastFetcher = (o: ConstructorParameters<typeof PoliteFetcher>[0] = {}) => new PoliteFetcher({ minIntervalMs: 0, timeoutMs: 3000, ...o });
export const CTX = { paperId: "pap_test", sourceId: "src_test" };
