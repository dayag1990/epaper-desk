import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firstFilePart } from "../src/lib/multipart.js";
import { serveEditor } from "../src/lib/static.js";
import { TYPE_QUEUE } from "../src/lib/enqueue.js";
import { QUEUES } from "../src/queue.js";
import { templateSet } from "../src/lib/templates.js";
import { paperRef, stripRef } from "../src/lib/domain.js";

describe("multipart upload reader", () => {
  it("finds the file part and keeps the bytes exactly", () => {
    const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x0d, 0x0a, 0x01, 0xff]);
    const body = Buffer.concat([
      Buffer.from('--XX\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n--XX\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'),
      bytes,
      Buffer.from("\r\n--XX--\r\n"),
    ]);
    const part = firstFilePart(body, "multipart/form-data; boundary=XX")!;
    expect(part.name).toBe("a.jpg");
    expect(part.type).toBe("image/jpeg");
    expect(part.data.equals(bytes)).toBe(true);
  });
  it("returns null when there is no file", () => {
    expect(firstFilePart(Buffer.from("--XX\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\nb\r\n--XX--\r\n"), "multipart/form-data; boundary=XX")).toBeNull();
  });
});

describe("editor static files", () => {
  it("shows a plain-words page when the editor is not built", async () => {
    process.env.EDITOR_DIST = path.join(tmpdir(), "no-such-editor-dist");
    const r = await serveEditor("/");
    expect(r.status).toBe(200);
    expect(String(r.body)).toContain("has not been installed");
  });
  it("serves the build, falls back to index.html for app paths, and refuses to leave the folder", async () => {
    const dist = mkdtempSync(path.join(tmpdir(), "dist-"));
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>editor</title>");
    writeFileSync(path.join(dist, "assets", "app.js"), "1");
    process.env.EDITOR_DIST = dist;
    expect((await serveEditor("/?edition=1")).type).toContain("text/html");
    expect((await serveEditor("/assets/app.js")).type).toContain("javascript");
    expect(String((await serveEditor("/some/route")).body)).toContain("editor");
    expect((await serveEditor("/missing.png")).status).toBe(404);
    expect((await serveEditor("/..%2f..%2fetc/passwd")).status).toBe(404);
  });
});

describe("jobs and templates", () => {
  it("every job type goes to a real queue", () => {
    for (const q of Object.values(TYPE_QUEUE)) expect(QUEUES).toContain(q);
  });
  it("loads the broadsheet set and refuses odd names", () => {
    process.env.TEMPLATES_DIR = path.resolve(__dirname, "../../../templates");
    expect(templateSet("broadsheet-en")!.length).toBeGreaterThan(1);
    expect(templateSet("../etc")).toBeNull();
  });
  it("ids keep their prefix both ways", () => {
    expect(stripRef(paperRef("abc"))).toBe("abc");
  });
});
