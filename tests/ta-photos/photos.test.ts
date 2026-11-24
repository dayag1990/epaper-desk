import { describe, it, expect } from "vitest";
import fs from "node:fs";
// @ts-expect-error plain ESM script without types
import { verify, CREDITS_PATH } from "../../scripts/photos/verify-credits.mjs";
// @ts-expect-error plain ESM script without types
import { classifyLicence, shortenCredit } from "../../scripts/photos/lib.mjs";

describe("licence policy", () => {
  it.each(["CC0 1.0", "Public domain", "PD-old-70", "PD US Government", "CC BY 2.0", "CC BY 4.0", "CC BY-SA 3.0", "CC BY-SA 4.0"])("accepts %s", (l) => {
    expect(classifyLicence(l).ok).toBe(true);
  });
  it.each(["CC BY-NC 2.0", "CC BY-ND 2.0", "CC BY-NC-SA 4.0", "CC BY-NC-ND 3.0", "All rights reserved", "GFDL", "Fair use", "", undefined, "unknown", "Free Art License"])("rejects %s", (l) => {
    expect(classifyLicence(l as string).ok).toBe(false);
  });
});

describe("credit line", () => {
  it("keeps the licence and stays within 70 chars", () => {
    const long = "A".repeat(80);
    const c = shortenCredit(long, "CC BY-SA 4.0");
    expect([...c].length).toBeLessThanOrEqual(70);
    expect(c).toContain("(CC BY-SA 4.0)");
    expect(c.startsWith("படம்: ")).toBe(true);
    expect(c).toContain("…");
    expect(shortenCredit("Ravi", "CC0 1.0")).toBe("படம்: Ravi / Wikimedia Commons (CC0 1.0)");
  });
});

describe("photo pool on disk", () => {
  it("credits file exists and the folder matches it", () => {
    expect(fs.existsSync(CREDITS_PATH)).toBe(true);
  });
  it("passes every verify-credits rule", async () => {
    const { errors, stats } = await verify();
    expect(errors).toEqual([]);
    expect(stats.count).toBeGreaterThanOrEqual(80);
    expect(stats.big).toBeGreaterThanOrEqual(20);
    for (const n of Object.values(stats.perSection) as number[]) expect(n).toBeGreaterThanOrEqual(8);
  }, 600_000);
  it("detects a tampered credits file", async () => {
    const doc = JSON.parse(fs.readFileSync(CREDITS_PATH, "utf8"));
    doc.photos[0].licence_short = "CC BY-NC 2.0";
    doc.photos[1].credit_line = "x".repeat(71);
    doc.photos[2].sha256 = "0".repeat(64);
    const tmp = `${process.env.TMPDIR || "/tmp"}/ta-photos-tampered-${process.pid}.json`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    try {
      const { errors } = await verify({ creditsPath: tmp });
      expect(errors.some((e: string) => /licence not allowed/.test(e))).toBe(true);
      expect(errors.some((e: string) => /credit_line > 70/.test(e))).toBe(true);
      expect(errors.some((e: string) => /sha256 mismatch/.test(e))).toBe(true);
    } finally { fs.rmSync(tmp, { force: true }); }
  }, 600_000);
});
