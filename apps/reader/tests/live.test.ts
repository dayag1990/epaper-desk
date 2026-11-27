import { describe, expect, it } from "vitest";
import { editionChanged, eventsUrl } from "../src/lib/source";

const ed = { id: "e1", paper: "riverton-herald", date: "2026-11-18", pages: 24, version: 1 };
describe("a re-exported or corrected edition is noticed", () => {
  it("same edition, same version: nothing to do", () => expect(editionChanged(ed, { ...ed })).toBe(false));
  it("a new version (a corrected page, a second publish), another id, another date or page count: reload", () => {
    for (const change of [{ version: 2 }, { id: "e2" }, { date: "2026-11-19" }, { pages: 25 }]) expect(editionChanged(ed, { ...ed, ...change })).toBe(true);
  });
  it("an edition without a version number (the static folder) is compared by its id and date", () => {
    const s = { id: "sha1", paper: "p", date: "2026-11-18", pages: 24 };
    expect(editionChanged(s, { ...s })).toBe(false);
    expect(editionChanged(s, { ...s, id: "sha2" })).toBe(true);
  });
});
describe("where the live stream is", () => {
  it("the public stream of this paper for the HTTP source; none for a static folder (it is checked every 15 s)", () => {
    expect(eventsUrl({ source: "http", apiBase: "/", paper: "riverton-herald" })).toBe("/v1/public/papers/riverton-herald/events");
    expect(eventsUrl({ source: "http", apiBase: "https://api.example.test/", paper: "a b" })).toBe("https://api.example.test/v1/public/papers/a%20b/events");
    expect(eventsUrl({ source: "static", staticBase: "./ed", paper: "x" })).toBeNull();
  });
});
