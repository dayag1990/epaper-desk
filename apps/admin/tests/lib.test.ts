import { describe, expect, it } from "vitest";
import { caps, parseScreen, screensFor } from "../src/lib/roles";
import { ApiError, checkDate, confidenceWords, fillTone, fillWords, isBusy, mappingToRows, nextStep, plainError, rowsToMapping, tomorrow } from "../src/lib/words";
import { Api } from "../src/api";
import type { Overview } from "../src/types";

const ov = (p: Partial<Overview> = {}): Overview => ({ id: "e", date: "2026-11-24", name: "", status: "draft", pages: [], exports: [], reader: null, ...p });
const pg = (status: string, fit = 90) => ({ id: "p" + Math.random(), no: 1, fit_pct: fit, status });

describe("roles", () => {
  it("only an owner sees people, connections, activity and settings", () => {
    expect(screensFor("owner")).toContain("settings");
    for (const r of ["editor", "sub", "designer", "viewer"] as const) expect(screensFor(r)).toEqual(["editions", "articles", "sources"]);
  });
  it("viewer can do nothing that writes", () => {
    expect(Object.values(caps("viewer")).some(Boolean)).toBe(false);
  });
  it("capabilities match the API's role checks", () => {
    expect(caps("sub")).toMatchObject({ manageSources: false, editArticles: true, workEditions: true, publish: false, admin: false });
    expect(caps("designer")).toMatchObject({ editArticles: false, workEditions: true });
    expect(caps("editor")).toMatchObject({ manageSources: true, publish: true, admin: false });
  });
  it("a hash for a screen the role cannot see falls back", () => {
    expect(parseScreen("#/settings", "editor")).toBe("editions");
    expect(parseScreen("#/settings", "owner")).toBe("settings");
    expect(parseScreen("", "viewer")).toBe("editions");
  });
});

describe("words", () => {
  it("errors are plain", () => {
    expect(plainError(new ApiError(0, "network", "x"))).toMatch(/Can't reach the server/);
    expect(plainError(new ApiError(401, "x", "x"))).toMatch(/signed out/);
    expect(plainError(new ApiError(401, "bad_login", "That email and password do not match."))).toBe("That email and password do not match.");
    expect(plainError(new ApiError(500, "x", "boom stack"))).not.toMatch(/boom/);
    expect(plainError(new ApiError(409, "last_owner", "A paper needs at least one owner."))).toBe("A paper needs at least one owner.");
    expect(plainError(new Error("TypeError x"))).not.toMatch(/TypeError/);
  });
  it("confidence bands", () => {
    expect(confidenceWords(0.86).tone).toBe("good");
    expect(confidenceWords(0.7).tone).toBe("ok");
    expect(confidenceWords(0.3).label).toMatch(/Weak match \(30%\)/);
  });
  it("fill", () => {
    expect([fillTone(null), fillTone(40), fillTone(95), fillTone(120)]).toEqual(["none", "low", "good", "over"]);
    expect(fillWords(92)).toBe("92% full");
  });
  it("dates", () => {
    expect(tomorrow(new Date("2026-11-23T10:00:00Z"))).toBe("2026-11-24");
    expect(checkDate("2026-11-24")).toBeNull();
    expect(checkDate("2026-02-30")).toMatch(/does not exist/);
    expect(checkDate("")).toMatch(/Pick a date/);
  });
  it("mapping rows round trip and validate", () => {
    const rows = mappingToRows({ headline: "h1", body: "p" });
    expect(rowsToMapping(rows)).toEqual({ mapping: { headline: "h1", body: "p" }, error: null });
    expect(rowsToMapping([{ field: "body", expr: "p" }]).error).toMatch(/headline/);
    expect(rowsToMapping([{ field: "headline", expr: "" }]).error).toMatch(/no rule/);
    expect(rowsToMapping([{ field: "headline", expr: "a" }, { field: "headline", expr: "b" }]).error).toMatch(/twice/);
    expect(rowsToMapping([{ field: "headline", expr: "a" }, { field: "", expr: "" }]).error).toBeNull();
  });
});

describe("edition next step", () => {
  it("walks the whole way", () => {
    expect(nextStep(ov())).toMatch(/Auto-plan/);
    expect(nextStep(ov({ status: "planning" }))).toMatch(/Planning/);
    expect(nextStep(ov({ pages: [pg("draft"), pg("approved")] }))).toMatch(/1 page still needs a look/);
    expect(nextStep(ov({ pages: [pg("approved")] }))).toMatch(/Make the PDF/);
    expect(nextStep(ov({ pages: [pg("approved")], exports: [{ id: "x", format: "pdf_screen", status: "done", url: "u" }], reader: { id: "r", status: "ready", version: 1, publish_at: null } }))).toMatch(/Publish to the reader/);
    expect(nextStep(ov({ pages: [pg("approved")], exports: [{ id: "x", format: "pdf_screen", status: "done", url: "u" }], reader: { id: "r", status: "published", version: 1, publish_at: null } }))).toMatch(/Live/);
  });
  it("polls only while something is running", () => {
    expect(isBusy(null)).toBe(false);
    expect(isBusy(ov({ status: "planning" }))).toBe(true);
    expect(isBusy(ov({ exports: [{ id: "x", format: "cxml", status: "running", url: null }] }))).toBe(true);
    expect(isBusy(ov({ pages: [pg("draft")] }))).toBe(false);
  });
});

describe("api client", () => {
  const fake = (status: number, body: unknown) => new Api("", async () => new Response(JSON.stringify(body), { status }));
  it("turns error replies into ApiError with the server's plain message", async () => {
    await expect(fake(403, { code: "forbidden", message: "Viewers can look but not save." }).setAi(true)).rejects.toMatchObject({ status: 403, message: "Viewers can look but not save." });
  });
  it("maps a dead network to status 0", async () => {
    await expect(new Api("", async () => { throw new TypeError("fetch failed"); }).me()).rejects.toMatchObject({ status: 0 });
  });
  it("sends the cookie and the right path", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const a = new Api("", async (url, init) => { seen = { url, init }; return new Response("{}", { status: 200 }); });
    await a.articles({ q: "a b", section: "", hidden: "no" });
    expect(seen!.url).toBe("/v1/admin/articles?q=a%20b&hidden=no");
    expect(seen!.init!.credentials).toBe("include");
  });
});
