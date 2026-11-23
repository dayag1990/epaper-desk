import type { EditionInfo, EditionSource, PageInfo, ReaderConfig, TextPage, ZoneSet } from "./types";

const join = (base: string, p: string) => base.replace(/\/+$/, "") + "/" + p.replace(/^\/+/, "");
/** A message that is safe to show a reader as it is (plain words, no codes, no URLs). */
export class FriendlyError extends Error {
  readonly friendly = true;
}
async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}
const abs = (base: string, u: string) => (/^(https?:)?\/\//.test(u) || u.startsWith("data:") ? u : join(base, u));

/** The API sends image levels as [{w, url}]; older shapes sent {"400": url}. Accept both. */
export function imageLevels(base: string, images: unknown): Record<number, string> {
  if (Array.isArray(images)) return Object.fromEntries(images.map((i: any) => [Number(i.w), abs(base, String(i.url))]));
  return Object.fromEntries(Object.entries((images ?? {}) as Record<string, unknown>).map(([k, v]) => [Number(k), abs(base, String(v))]));
}

/** HTTP source over the public read routes of the API (D5 zones at /pages/:id/zones). */
export class HttpSource implements EditionSource {
  constructor(private base: string, private paper: string) {}

  async edition(date?: string): Promise<EditionInfo> {
    const q = date && date !== "latest" ? `?date=${encodeURIComponent(date)}` : "";
    const r = await fetch(join(this.base, `/v1/public/papers/${encodeURIComponent(this.paper)}/editions${q}`));
    if (r.status === 404) throw new FriendlyError("This paper was not found.");
    if (!r.ok) throw new Error(`${r.status}`);
    const body = await r.json();
    const list: any[] = Array.isArray(body) ? body : body.editions ?? body.items ?? [];
    if (!list.length) throw new FriendlyError("No edition published yet.");
    const e = [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    return { id: e.id, paper: (!Array.isArray(body) && body.paper?.name) || this.paper, date: String(e.date).slice(0, 10), pages: e.pages ?? e.page_count ?? 0 };
  }

  async pages(ed: EditionInfo): Promise<PageInfo[]> {
    const body = await getJson<any>(join(this.base, `/v1/public/editions/${ed.id}/pages`));
    const list: any[] = Array.isArray(body) ? body : body.pages ?? [];
    return list.map((p, i): PageInfo => ({
      id: p.id,
      no: p.no ?? p.page ?? i + 1,
      image: p.image ?? { w: p.w, h: p.h },
      images: imageLevels(this.base, p.images),
      zonesUrl: join(this.base, `/v1/public/pages/${p.id}/zones`),
      textUrl: p.text_url ? abs(this.base, p.text_url) : null,
      pdfUrl: p.pdf_url ? abs(this.base, p.pdf_url) : null,
    })).sort((a, b) => a.no - b.no);
  }

  zones(p: PageInfo) { return getJson<ZoneSet>(p.zonesUrl); }
  async text(p: PageInfo): Promise<TextPage | null> { return p.textUrl ? getJson<TextPage>(p.textUrl).catch(() => null) : null; }
}

/** Static source: a folder written by @epaper/epaper buildEdition, plus a latest.json pointer. */
export class StaticSource implements EditionSource {
  constructor(private base: string, private paper: string) {}

  async edition(): Promise<EditionInfo> {
    const l = await getJson<{ sha: string; paper?: string; date: string; pages?: number }>(join(this.base, "latest.json"));
    return { id: l.sha, paper: l.paper ?? this.paper, date: l.date, pages: l.pages ?? 0 };
  }

  async pages(ed: EditionInfo): Promise<PageInfo[]> {
    const m = await getJson<{ pages: number; widths: number[]; format: string }>(join(this.base, `${ed.id}/manifest.json`));
    const nos = Array.from({ length: m.pages }, (_, i) => i + 1);
    return Promise.all(nos.map(async (no): Promise<PageInfo> => {
      const dir = join(this.base, `${ed.id}/pages/${String(no).padStart(4, "0")}`);
      const meta = await getJson<{ image: { w: number; h: number } }>(`${dir}/page.json`);
      return {
        id: `${ed.id}:${no}`, no, image: meta.image,
        images: Object.fromEntries(m.widths.map((w) => [w, `${dir}/w${w}.${m.format}`])),
        zonesUrl: `${dir}/zones.json`, textUrl: `${dir}/text.json`, pdfUrl: `${dir}/page.pdf`,
      };
    }));
  }

  zones(p: PageInfo) { return getJson<ZoneSet>(p.zonesUrl); }
  async text(p: PageInfo): Promise<TextPage | null> { return p.textUrl ? getJson<TextPage>(p.textUrl).catch(() => null) : null; }
}

export async function loadConfig(): Promise<ReaderConfig> {
  const r = await fetch("./config.json");
  if (!r.ok) throw new Error("config.json missing");
  const c: ReaderConfig = await r.json();
  const paper = new URLSearchParams(location.search).get("paper");
  return paper ? { ...c, paper } : c;
}

export function makeSource(c: ReaderConfig): EditionSource {
  return c.source === "static" ? new StaticSource(c.staticBase ?? "./ed", c.paper) : new HttpSource(c.apiBase ?? "/", c.paper);
}
