import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", webp: "image/webp", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", map: "application/json", txt: "text/plain; charset=utf-8" };

export const editorDist = () => process.env.EDITOR_DIST ?? path.resolve(process.cwd(), "../editor/dist");

const PLACEHOLDER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>E-Paper Desk</title>
<style>body{font:16px system-ui,sans-serif;max-width:34em;margin:12vh auto;padding:0 1em;color:#222}code{background:#eee;padding:0 .3em}</style></head>
<body><h1>E-Paper Desk</h1><p>The server is running, but the page editor has not been installed on it yet.</p>
<p>Everything else works: the API is at <code>/v1</code> and its documentation at <a href="/docs">/docs</a>.</p>
<p>If you are the owner: the editor is added in the next release. Nothing is lost while you wait.</p></body></html>`;

/** Static file for a URL path under the editor build, or null. SPA: unknown paths without a dot fall back to index.html. */
export async function serveEditor(urlPath: string): Promise<{ type: string; body: Buffer | string; status: number; cache: string }> {
  const dist = editorDist();
  if (!existsSync(path.join(dist, "index.html"))) return { type: MIME.html!, body: PLACEHOLDER, status: 200, cache: "no-store" };
  const rel = decodeURIComponent(urlPath.split("?")[0]!).replace(/^\/+/, "");
  const abs = path.resolve(dist, rel || "index.html");
  if (abs !== dist && !abs.startsWith(dist + path.sep)) return { type: MIME.txt!, body: "Not found", status: 404, cache: "no-store" };
  if (existsSync(abs) && statSync(abs).isFile()) {
    const ext = abs.split(".").pop()!;
    return { type: MIME[ext] ?? "application/octet-stream", body: await readFile(abs), status: 200, cache: abs.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache" };
  }
  if (/\.[a-z0-9]{1,6}$/i.test(rel)) return { type: MIME.txt!, body: "Not found", status: 404, cache: "no-store" };
  return { type: MIME.html!, body: await readFile(path.join(dist, "index.html")), status: 200, cache: "no-cache" };
}
