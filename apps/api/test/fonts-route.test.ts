import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { fontRoutes } from "../src/routes/fonts.js";

const ROOT = path.resolve(__dirname, "../../..");
const NOTO = "noto-serif-tamil/NotoSerifTamil[wdth,wght].ttf";
const ANEK = "anek-tamil/AnekTamil[wdth,wght].ttf";
const url = (rel: string) => "/fonts/" + rel.split("/").map(encodeURIComponent).join("/");

async function app() {
  const a = Fastify();
  fontRoutes(a);
  await a.ready();
  return a;
}

describe("GET /fonts/*", () => {
  it("serves both Tamil fonts byte for byte, as font/ttf, cached for a year, with CORS", async () => {
    const a = await app();
    for (const rel of [NOTO, ANEK]) {
      const r = await a.inject({ method: "GET", url: url(rel) });
      expect(r.statusCode, rel).toBe(200);
      expect(r.headers["content-type"]).toBe("font/ttf");
      expect(r.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(r.headers["access-control-allow-origin"]).toBe("*");
      expect(r.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(Buffer.compare(r.rawPayload, readFileSync(path.join(ROOT, "templates/fonts", rel)))).toBe(0);
    }
    await a.close();
  });

  it("answers 304 to a matching ETag and HEAD without a body", async () => {
    const a = await app();
    const first = await a.inject({ method: "GET", url: url(ANEK) });
    const again = await a.inject({ method: "GET", url: url(ANEK), headers: { "if-none-match": String(first.headers.etag) } });
    expect(again.statusCode).toBe(304);
    const head = await a.inject({ method: "HEAD", url: url(ANEK) });
    expect(head.statusCode).toBe(200);
    expect(head.rawPayload.length).toBe(0);
    await a.close();
  });

  it("refuses path traversal, absolute and encoded tricks, dotfiles, other file types and folders", async () => {
    const a = await app();
    const bad = [
      "/fonts/../broadsheet-en/front_a.json",
      "/fonts/%2e%2e/broadsheet-en/front_a.json",
      "/fonts/%2e%2e%2fbroadsheet-en%2ffront_a.json",
      "/fonts/noto-serif-tamil/%2e%2e/%2e%2e/broadsheet-en/front_a.json",
      "/fonts/..%5cbroadsheet-en%5cfront_a.json",
      "/fonts/%252e%252e/broadsheet-en/front_a.json",
      "/fonts/noto-serif-tamil/OFL.txt",
      "/fonts/README.md",
      "/fonts/noto-serif-tamil/",
      "/fonts/noto-serif-tamil",
      "/fonts/",
      "/fonts//etc/passwd",
      "/fonts/nope.ttf",
      "/fonts/noto-serif-tamil/NotoSerifTamil%00.ttf",
    ];
    for (const u of bad) {
      const r = await a.inject({ method: "GET", url: u });
      expect(r.statusCode, u).toBe(404);
      expect(String(r.headers["content-type"]), u).not.toMatch(/font/);
      expect(r.body, u).not.toContain("demo_default"); // nothing of the template JSON leaks
    }
    await a.close();
  });
});
