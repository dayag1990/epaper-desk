import { createReadStream, statSync } from "node:fs";
import { fontContentType, fontsDir, resolveFontFile } from "@epaper/layout";
import type { FastifyInstance } from "fastify";

/**
 * GET /fonts/<folder>/<file>: the template fonts (templates/fonts), read only, as web fonts for the editor.
 * Only font files inside that folder are served (no "..", no dotfiles, no other file types). The files never change
 * under one name, so they are cached for a year. Open to anyone and CORS-enabled: the fonts are SIL OFL and carry no data.
 */
export function fontRoutes(app: FastifyInstance) {
  const handler = async (req: any, reply: any) => {
    const rel = new URL(req.url, "http://x").pathname.slice("/fonts/".length);
    const file = resolveFontFile(fontsDir(), rel);
    if (!file) return reply.status(404).header("access-control-allow-origin", "*").send({ code: "not_found", message: "There is no such font.", details: {} });
    const st = statSync(file);
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    reply
      .header("content-type", fontContentType(file)!)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("access-control-allow-origin", "*")
      .header("cross-origin-resource-policy", "cross-origin")
      .header("x-content-type-options", "nosniff")
      .header("etag", etag);
    if (req.headers["if-none-match"] === etag) return reply.status(304).send();
    reply.header("content-length", st.size);
    return req.method === "HEAD" ? reply.send() : reply.send(createReadStream(file));
  };
  app.get("/fonts/*", handler);
}
