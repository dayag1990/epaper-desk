import { afterEach, describe, expect, it, vi } from "vitest";
import { FriendlyError, HttpSource, imageLevels } from "../src/lib/source";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("HttpSource against the real API shapes", () => {
  it("a paper with no edition says so in plain words", async () => {
    vi.stubGlobal("fetch", async () => reply(200, { paper: { slug: "p" }, items: [] }));
    const e = await new HttpSource("/", "p").edition().catch((x) => x);
    expect(e).toBeInstanceOf(FriendlyError);
    expect(e.message).toBe("No edition published yet.");
  });
  it("an unknown paper (404) says so in plain words, not '404 /v1/...'", async () => {
    vi.stubGlobal("fetch", async () => reply(404, { code: "not_found", message: "That paper was not found." }));
    const e = await new HttpSource("/", "nope").edition().catch((x) => x);
    expect(e).toBeInstanceOf(FriendlyError);
    expect(e.message).toBe("This paper was not found.");
    expect(e.message).not.toMatch(/404|\/v1/);
  });
  it("a server fault is not shown as friendly text", async () => {
    vi.stubGlobal("fetch", async () => reply(500, {}));
    const e = await new HttpSource("/", "p").edition().catch((x) => x);
    expect(e).not.toBeInstanceOf(FriendlyError);
  });
  it("picks the newest edition", async () => {
    vi.stubGlobal("fetch", async () => reply(200, { items: [{ id: "a", date: "2026-11-22" }, { id: "b", date: "2026-11-23" }] }));
    expect((await new HttpSource("/", "p").edition()).id).toBe("b");
  });
  it("shows the paper's name, not its slug", async () => {
    vi.stubGlobal("fetch", async () => reply(200, { paper: { slug: "riverton-herald", name: "The Riverton Herald" }, items: [{ id: "a", date: "2026-11-23" }] }));
    expect((await new HttpSource("/", "riverton-herald").edition()).paper).toBe("The Riverton Herald");
  });
  it("reads image levels as the API sends them ([{w,url}]) and as the older object", () => {
    expect(imageLevels("/", [{ w: 400, url: "/v1/public/pages/x/image/400" }, { w: 1600, url: "/v1/public/pages/x/image/1600" }]))
      .toEqual({ 400: "/v1/public/pages/x/image/400", 1600: "/v1/public/pages/x/image/1600" });
    expect(imageLevels("/", { "400": "/a.webp" })).toEqual({ 400: "/a.webp" });
    expect(imageLevels("/", undefined)).toEqual({});
  });
  it("maps the real pages response so every page has image levels", async () => {
    const pages = [{ id: "p1", no: 1, w: 3200, h: 4855, images: [{ w: 400, url: "/v1/public/pages/p1/image/400" }, { w: 1600, url: "/v1/public/pages/p1/image/1600" }, { w: 3200, url: "/v1/public/pages/p1/image/3200" }] }];
    vi.stubGlobal("fetch", async () => reply(200, { id: "e", pages }));
    const out = await new HttpSource("/", "p").pages({ id: "e", paper: "p", date: "2026-11-23", pages: 0 });
    expect(out[0].images[400]).toBe("/v1/public/pages/p1/image/400");
    expect(out[0].image).toEqual({ w: 3200, h: 4855 });
    expect(out[0].zonesUrl).toBe("/v1/public/pages/p1/zones");
  });
});
