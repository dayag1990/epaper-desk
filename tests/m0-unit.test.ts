import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileExistsError, FsDriver, S3Driver, fileKey, sha256 } from "../apps/api/src/files/index.js";
import { queueEnabled } from "../apps/worker/src/main.js";

const PAPER = "11111111-1111-4111-8111-111111111111";

describe("files lib", () => {
  it("builds {paper}/{date}/{kind}/{hash}.{ext}", () => {
    const hash = sha256(Buffer.from("x"));
    expect(fileKey({ paper: PAPER, date: "2026-11-23", kind: "original", hash, ext: "jpg" })).toBe(`${PAPER}/2026-11-23/original/${hash}.jpg`);
  });
  it("refuses path tricks", () => {
    const hash = sha256(Buffer.from("x"));
    expect(() => fileKey({ paper: PAPER, date: "2026-11-23", kind: "../x", hash, ext: "jpg" })).toThrow();
    expect(() => fileKey({ paper: "../../etc", date: "2026-11-23", kind: "a", hash, ext: "jpg" })).toThrow();
  });
  it("writes once and never overwrites", async () => {
    const d = new FsDriver(await mkdtemp(path.join(tmpdir(), "files-")));
    const data = Buffer.from("hello");
    const key = fileKey({ paper: PAPER, date: "2026-11-23", kind: "original", hash: sha256(data), ext: "txt" });
    await d.put(key, data);
    await expect(d.put(key, Buffer.from("other"))).rejects.toBeInstanceOf(FileExistsError);
    expect((await d.get(key)).toString()).toBe("hello");
  });
  it("s3 driver is an interface stub", async () => {
    await expect(new S3Driver().put()).rejects.toThrow(/not built/);
  });
});

describe("AI is optional", () => {
  it("the ai queue is silent unless AI_ENABLED is exactly true", () => {
    expect(queueEnabled("ai", {} as any)).toBe(false);
    expect(queueEnabled("ai", { AI_ENABLED: "false" } as any)).toBe(false);
    expect(queueEnabled("ai", { AI_ENABLED: "true" } as any)).toBe(true);
    expect(queueEnabled("ingest", {} as any)).toBe(true);
  });
});
void readFile;
