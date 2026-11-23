/**
 * DOM-side measuring. Every function here is SELF-CONTAINED (no imports, no closures) so
 * Playwright can serialise it into Chromium and the editor can call the very same code.
 * Declared with the DOM lib; the package tsconfig includes it.
 */

export interface FillArgs {
  fsPx?: number;
  padTB: number;
  canvas: number;
  wmm: number;
  hmm: number;
}
/** Prototype fillOf(): optionally sets the body size first. Returns the fill ratio (1 = full). */
export function domFill(a: FillArgs): number {
  const page = document.querySelector(".page") as HTMLElement;
  if (a.fsPx != null) {
    page.dataset.fs = String(a.fsPx);
    page.style.setProperty("--fs", a.fsPx + "px");
  }
  const pr = page.getBoundingClientRect();
  const sr = (page.querySelector(".sheet") as HTMLElement).getBoundingClientRect();
  if (!pr.width) return 0;
  return (sr.height / pr.width + a.padTB / a.canvas) / (a.hmm / a.wmm);
}

export interface RawFrame {
  item: string;
  role: string;
  x: number; // fractions of page width (0..1), origin page top-left
  y: number;
  w: number;
  h: number;
  fontPx?: number;
  fontFamily?: string;
  style?: string;
  text?: string;
  paras?: string[];
  cols?: number;
  gutterPx?: number;
  asset?: string;
  src?: string;
  natW?: number;
  natH?: number;
  focal?: [number, number];
  cutout?: boolean;
  /** frame width as a fraction of page width, used for the dpi rule */
}
export interface RawPage {
  pageW: number; // px (as laid out, includes zoom)
  pageHpx: number;
  frames: RawFrame[];
}

/** Collect the rectangle of every frame on the first .page, as fractions of the page width. */
export function domFrames(): RawPage {
  const page = document.querySelector(".page") as HTMLElement;
  const pr = page.getBoundingClientRect();
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.width, w: r.width / pr.width, h: r.height / pr.width };
  };
  const cs = (el: Element) => getComputedStyle(el);
  const fam = (el: Element) => cs(el).fontFamily.split(",")[0]!.replace(/["']/g, "").trim();
  const frames: RawFrame[] = [];
  const mast = page.querySelector(".mast");
  if (mast) frames.push({ item: "it_furniture", role: "masthead", ...rect(mast), fontPx: parseFloat(cs(mast.querySelector(".name") ?? mast).fontSize), fontFamily: fam(mast.querySelector(".name") ?? mast), text: (mast.textContent ?? "").replace(/\s+/g, " ").trim() });
  const strip = page.querySelector(".strip");
  if (strip) frames.push({ item: "it_furniture", role: "strip", ...rect(strip), fontPx: parseFloat(cs(strip).fontSize), fontFamily: fam(strip), text: (strip.textContent ?? "").replace(/\s+/g, " ").trim() });
  page.querySelectorAll<HTMLElement>(".story").forEach((s) => {
    const item = s.dataset.item ?? "";
    const k = s.querySelector(".kicker");
    if (k) frames.push({ item, role: "kicker", ...rect(k), fontPx: parseFloat(cs(k).fontSize), fontFamily: fam(k), text: (k.textContent ?? "").trim() });
    const h = s.querySelector<HTMLElement>(".head");
    if (h) frames.push({ item, role: "head", ...rect(h), fontPx: parseFloat(cs(h).fontSize), fontFamily: fam(h), style: h.dataset.style, text: (h.textContent ?? "").trim() });
    const sub = s.querySelector<HTMLElement>(".sub");
    if (sub) frames.push({ item, role: "sub", ...rect(sub), fontPx: parseFloat(cs(sub).fontSize), fontFamily: fam(sub), style: sub.dataset.style, text: (sub.textContent ?? "").trim() });
    const fig = s.querySelector<HTMLElement>(".fig");
    if (fig) {
      const im = fig.querySelector("img");
      frames.push({
        item, role: s.dataset.kind === "ad" ? "ad" : "image", ...rect(fig),
        asset: fig.dataset.asset, src: im ? im.getAttribute("src") ?? undefined : undefined,
        natW: im ? im.naturalWidth : 0, natH: im ? im.naturalHeight : 0,
        focal: im ? ((im.style.objectPosition || "50% 50%").split(" ").map((v) => parseFloat(v) / 100) as [number, number]) : [0.5, 0.5],
      });
    }
    const b = s.querySelector<HTMLElement>(".body");
    if (b) {
      const bs = cs(b);
      frames.push({
        item, role: "body", ...rect(b), fontPx: parseFloat(bs.fontSize), fontFamily: fam(b), style: b.dataset.style,
        cols: parseInt(bs.columnCount, 10) || 1, gutterPx: parseFloat(bs.columnGap) || 0,
        paras: Array.from(b.querySelectorAll("p")).map((p) => (p.textContent ?? "").trim()).filter(Boolean),
      });
    }
  });
  return { pageW: pr.width, pageHpx: pr.height, frames };
}

/** Wait for fonts and images, so measuring happens after layout settles. */
export async function domReady(): Promise<void> {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images).map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = () => r(0); }))),
  );
}
