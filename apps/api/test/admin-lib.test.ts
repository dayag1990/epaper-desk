import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiKeyPresent, plainSourceStatus } from "../src/lib/admin.js";
import { serveAdmin } from "../src/lib/admin-static.js";

describe("plain words", () => {
  it("AI key presence ignores blanks", () => {
    expect(aiKeyPresent({})).toBe(false);
    expect(aiKeyPresent({ ANTHROPIC_API_KEY: "  " } as any)).toBe(false);
    expect(aiKeyPresent({ ANTHROPIC_API_KEY: "k" } as any)).toBe(true);
  });
  it("source status", () => {
    expect(plainSourceStatus("idle", null).state).toBe("never");
    expect(plainSourceStatus("syncing", null).state).toBe("syncing");
    expect(plainSourceStatus("ok: 3 new, 0 changed, 1 same", new Date("2026-11-24T05:00:00Z")).text).toContain("2026-11-24 05:00 UTC");
    expect(plainSourceStatus("error: robots said no", null).text).toContain("robots said no");
  });
});

describe("admin static files", () => {
  it("serves the build under /admin, falls back for app paths, stays inside the folder", async () => {
    const dist = mkdtempSync(path.join(tmpdir(), "adm-"));
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(path.join(dist, "index.html"), "<title>admin</title>");
    writeFileSync(path.join(dist, "assets", "a.js"), "1");
    process.env.ADMIN_DIST = dist;
    expect((await serveAdmin("/admin")).type).toContain("text/html");
    expect((await serveAdmin("/admin/assets/a.js")).type).toContain("javascript");
    expect(String((await serveAdmin("/admin/sources")).body)).toContain("admin");
    expect((await serveAdmin("/admin/nope.png")).status).toBe(404);
    expect((await serveAdmin("/admin/..%2f..%2fetc/passwd")).status).toBe(404);
    process.env.ADMIN_DIST = path.join(tmpdir(), "no-admin");
    expect(String((await serveAdmin("/admin")).body)).toContain("not been installed");
  });
});
