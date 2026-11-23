// Placeholder ops service. Standalone on purpose: no api, worker or Prisma imports.
import http from "node:http";

const port = Number(process.env.OPS_PORT ?? 8101);
http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("E-Paper Desk ops: placeholder. The full ops desk comes later.\n");
  })
  .listen(port, "0.0.0.0");
