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
  // Never measure with a fallback font: font-display is block, so an unloaded face would give a wrong fill %.
  document.fonts.forEach((f) => {
    if (f.status !== "loaded") throw new Error(`Font "${f.family}" is ${f.status}, not loaded: wait for domReady() before measuring.`);
  });
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

/**
 * Holes: in a ruled (uneven) layout the stories of a row are stretched to the row's height, and a story whose text ends early
 * leaves empty paper under it. Returns that empty area as a fraction of the sheet. Self-contained (serialised into Chromium).
 */
export function domHoles(): number {
  const page = document.querySelector(".page") as HTMLElement | null;
  const sheet = page?.querySelector(".sheet") as HTMLElement | null;
  if (!page || !sheet) return 0;
  const sr = sheet.getBoundingClientRect();
  if (!sr.width || !sr.height) return 0;
  let free = 0;
  page.querySelectorAll<HTMLElement>(".story").forEach((s) => {
    if (s.dataset.kind === "ad") return;
    const last = s.lastElementChild;
    if (!last) return;
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    const content = last.getBoundingClientRect().bottom + parseFloat(cs.paddingBottom || "0") + parseFloat(cs.borderBottomWidth || "0");
    free += Math.max(0, r.bottom - content) * r.width;
  });
  return free / (sr.width * sr.height);
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
  /** newspaper finish (see D4): id suffix for a second frame of the same role, block style, drop cap, run-in dateline, rule kind, colours */
  sfx?: string;
  block?: "brief" | "quote" | "panel";
  dropcap?: boolean;
  dateline?: string;
  rule?: "hair" | "heavy" | "double";
  color?: string;
  tint?: string;
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
  const hex = (c: string): string | undefined => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (!m || (m[4] !== undefined && +m[4] === 0)) return undefined;
    return "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("");
  };
  const ruled = page.classList.contains("ruled");
  /** an element the style hides (a pull quote prints no body) is not a frame */
  const shown = <T extends Element>(e: T | null): T | null => (e && getComputedStyle(e).display !== "none" ? e : null);
  const line = (item: string, sfx: string, role: "rule", x: number, y: number, w: number, h: number, rule: "hair" | "heavy" | "double", color: string | undefined) =>
    frames.push({ item, role, sfx, x: (x - pr.left) / pr.width, y: (y - pr.top) / pr.width, w: w / pr.width, h: h / pr.width, rule, color });
  const kindOf = (px: number, style: string): "hair" | "heavy" | "double" => (style === "double" ? "double" : px >= 3 ? "heavy" : "hair");
  const mast = page.querySelector(".mast");
  if (mast) frames.push({ item: "it_furniture", role: "masthead", ...rect(mast), fontPx: parseFloat(cs(mast.querySelector(".name") ?? mast).fontSize), fontFamily: fam(mast.querySelector(".name") ?? mast), text: (mast.textContent ?? "").replace(/\s+/g, " ").trim() });
  const strip = page.querySelector<HTMLElement>(".strip");
  if (strip) {
    frames.push({ item: "it_furniture", role: "strip", ...rect(strip), fontPx: parseFloat(cs(strip).fontSize), fontFamily: fam(strip), text: (strip.textContent ?? "").replace(/\s+/g, " ").trim() });
    if (ruled) {
      const r = strip.getBoundingClientRect(), c = cs(strip);
      const tw = parseFloat(c.borderTopWidth), bw = parseFloat(c.borderBottomWidth);
      if (tw > 0) line("it_furniture", "_top", "rule", r.left, r.top + tw / 2, r.width, 0, kindOf(tw, c.borderTopStyle), hex(c.borderTopColor));
      if (bw > 0) line("it_furniture", "_bottom", "rule", r.left, r.bottom - bw / 2, r.width, 0, kindOf(bw, c.borderBottomStyle), hex(c.borderBottomColor));
    }
  }
  page.querySelectorAll<HTMLElement>(".story").forEach((s) => {
    const item = s.dataset.item ?? "";
    const block = (s.dataset.block as "brief" | "quote" | "panel" | undefined) || undefined;
    const sr = s.getBoundingClientRect(), sc = cs(s);
    if (ruled && s.dataset.kind !== "ad") {
      const tw = parseFloat(sc.borderTopWidth), bw = parseFloat(sc.borderBottomWidth);
      if (block === "brief" || block === "panel") {
        const tint = block === "panel" ? hex(sc.backgroundColor) : undefined;
        frames.push({ item, role: "box", sfx: "", ...rect(s), block, color: hex(sc.borderTopColor), ...(tint ? { tint } : {}) });
      }
      if (block !== "brief" && tw > 0) line(item, "", "rule", sr.left, sr.top + tw / 2, sr.width, 0, kindOf(tw, sc.borderTopStyle), hex(sc.borderTopColor));
      if (block === "quote" && bw > 0) line(item, "2", "rule", sr.left, sr.bottom - bw / 2, sr.width, 0, kindOf(bw, sc.borderBottomStyle), hex(sc.borderBottomColor));
      const pb = getComputedStyle(s, "::before");
      if (pb.content !== "none" && pb.display !== "none" && parseFloat(pb.width) > 0) {
        const cg = parseFloat(getComputedStyle(page).getPropertyValue("--cg")) || 0;
        const k0 = pr.width / page.offsetWidth;
        line(item, "_v", "rule", sr.left - (cg * k0) / 2, sr.top, 0, sr.height, "hair", hex(pb.backgroundColor));
      }
    }
    s.querySelectorAll<HTMLElement>(".jump").forEach((j) => shown(j) && frames.push({ item, role: "jump", sfx: j.classList.contains("from") ? "_from" : "_to", ...rect(j), fontPx: parseFloat(cs(j).fontSize), fontFamily: fam(j), text: (j.textContent ?? "").trim(), block }));
    const by = shown(s.querySelector<HTMLElement>(".byline"));
    if (by) {
      const dl = by.dataset.dl ? ` \u00b7 ${by.dataset.dl}` : "";
      frames.push({ item, role: "byline", ...rect(by), fontPx: parseFloat(cs(by).fontSize), fontFamily: fam(by), style: by.dataset.style, text: ((by.textContent ?? "").trim() + dl).trim(), block });
    }
    const k = shown(s.querySelector(".kicker"));
    if (k) frames.push({ item, role: "kicker", ...rect(k), fontPx: parseFloat(cs(k).fontSize), fontFamily: fam(k), text: (k.textContent ?? "").trim(), block });
    const h = s.querySelector<HTMLElement>(".head");
    if (h) frames.push({ item, role: "head", ...rect(h), fontPx: parseFloat(cs(h).fontSize), fontFamily: fam(h), style: h.dataset.style, text: (h.textContent ?? "").trim(), block });
    const sub = s.querySelector<HTMLElement>(".sub");
    if (sub) frames.push({ item, role: "sub", ...rect(sub), fontPx: parseFloat(cs(sub).fontSize), fontFamily: fam(sub), style: sub.dataset.style, text: (sub.textContent ?? "").trim(), block });
    const fig = shown(s.querySelector<HTMLElement>(".fig"));
    if (fig) {
      const im = fig.querySelector("img");
      frames.push({
        item, role: s.dataset.kind === "ad" ? "ad" : "image", ...rect(fig),
        asset: fig.dataset.asset, src: im ? im.getAttribute("src") ?? undefined : undefined,
        natW: im ? im.naturalWidth : 0, natH: im ? im.naturalHeight : 0,
        focal: im ? ((im.style.objectPosition || "50% 50%").split(" ").map((v) => parseFloat(v) / 100) as [number, number]) : [0.5, 0.5],
      });
    }
    const cap = shown(s.querySelector<HTMLElement>(".cap"));
    if (cap) frames.push({ item, role: "caption", ...rect(cap), fontPx: parseFloat(cs(cap).fontSize), fontFamily: fam(cap), text: (cap.textContent ?? "").replace(/\s+/g, " ").trim() });
    const b = shown(s.querySelector<HTMLElement>(".body"));
    if (b) {
      const bs = cs(b);
      frames.push({
        item, role: "body", ...rect(b), fontPx: parseFloat(bs.fontSize), fontFamily: fam(b), style: b.dataset.style,
        cols: parseInt(bs.columnCount, 10) || 1, gutterPx: parseFloat(bs.columnGap) || 0,
        paras: Array.from(b.querySelectorAll("p")).map((p) => (p.textContent ?? "").trim()).filter(Boolean),
        block, dropcap: s.classList.contains("dc") || undefined, dateline: b.querySelector<HTMLElement>("p[data-dl]")?.dataset.dl || undefined,
      });
    }
  });
  return { pageW: pr.width, pageHpx: pr.height, frames };
}

/** Wait for fonts and images, so measuring happens after layout settles. */
export async function domReady(): Promise<void> {
  // A face is fetched lazily, when text first needs it, and fonts.ready can resolve before that starts:
  // ask for every declared face explicitly, then wait for anything still in flight.
  const faces: FontFace[] = [];
  document.fonts.forEach((f) => faces.push(f));
  await Promise.all(faces.map((f) => f.load().catch(() => null)));
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images).map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = () => r(0); }))),
  );
  // Cut-out photos: the text wraps round the OUTLINE of the picture. The outline is read from the PNG's alpha channel (a canvas,
  // so it needs a picture the page may read: a data: URI, the same origin, or CORS headers). The right edge of the opaque
  // part, row by row, becomes a CSS polygon in % of the figure (a left float: the text runs down its right side), so the wrap
  // scales with the figure and is the same in the editor, the headless render and the PDF. When the picture cannot be read
  // (another origin without CORS, no alpha at all) nothing is set and the float's own rectangle is the shape.
  document.querySelectorAll<HTMLElement>(".fig.cutout").forEach((fig) => {
    const img = fig.querySelector("img");
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    try {
      const sw = Math.min(img.naturalWidth, 200);
      const sh = Math.max(1, Math.round((img.naturalHeight * sw) / img.naturalWidth));
      const cv = document.createElement("canvas");
      cv.width = sw; cv.height = sh;
      const cx = cv.getContext("2d");
      if (!cx) return;
      cx.drawImage(img, 0, 0, sw, sh);
      const d = cx.getImageData(0, 0, sw, sh).data;
      const rows = Math.min(sh, 40);
      const pts: string[] = ["0% 0%"];
      let any = false, opaque = true;
      for (let r = 0; r < rows; r++) {
        // widest opaque extent of the rows of this band (top .. bottom of the band), so no part of the outline pokes out of the polygon
        const y0 = Math.floor((r * sh) / rows), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * sh) / rows));
        let right = -1;
        for (let y = y0; y < y1; y++) for (let x = sw - 1; x > right; x--) if (d[(y * sw + x) * 4 + 3]! > 76) { right = x; break; }
        if (right >= 0) any = true; else opaque = false;
        if (right < sw - 1) opaque = false;
        const xr = right < 0 ? 0 : ((right + 1) / sw) * 100;
        pts.push(`${xr.toFixed(2)}% ${((y0 / sh) * 100).toFixed(2)}%`, `${xr.toFixed(2)}% ${((y1 / sh) * 100).toFixed(2)}%`);
      }
      pts.push("0% 100%");
      if (any) fig.style.setProperty("shape-outside", opaque ? "border-box" : `polygon(${pts.join(",")}) border-box`);
    } catch {
      /* tainted canvas: keep the rectangle */
    }
  });
}

export interface DomLine {
  /** Stable id of the text element: "<item>.<role>[.<paragraph n>]" ("furniture.<class>.<n>" for masthead and strip). */
  key: string;
  /** Line number inside that element, 0-based, in visual order. */
  n: number;
  /** The words of the line joined by single spaces (as the source text spells them, NFC untouched). */
  text: string;
  first: string;
  /** Box of the line on the template canvas, CSS px relative to the .page top-left (zoom and transform divided out). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/**
 * Every line of text on the first .page, as the browser broke it: per text element, split into words with Range rects and
 * grouped by line. Self-contained (serialised into Chromium). Positions are on the canvas, so they do not depend on the
 * zoom the page is shown at. Call after domReady().
 */
export function domLines(): DomLine[] {
  const page = document.querySelector(".page") as HTMLElement;
  const pr = page.getBoundingClientRect();
  const k = pr.width / page.offsetWidth; // transform scale of the page (editor zoom, print scale)
  const out: DomLine[] = [];
  const els: { el: Element; key: string }[] = [];
  page.querySelectorAll(".mast .name, .mast .tag, .strip > *").forEach((el, i) => els.push({ el, key: `furniture.${el.className || el.tagName.toLowerCase()}.${i}` }));
  page.querySelectorAll<HTMLElement>(".story").forEach((s) => {
    const item = s.dataset.item ?? "";
    s.querySelectorAll(".kicker, .head, .sub, .cap, .cap .credit").forEach((el) => els.push({ el, key: `${item}.${el.className.split(" ")[0]}` }));
    s.querySelectorAll(".body p").forEach((el, i) => els.push({ el, key: `${item}.body.${i}` }));
  });
  for (const { el, key } of els) {
    const tn = Array.from(el.childNodes).find((c) => c.nodeType === 3) as Text | undefined;
    if (!tn) continue;
    // one Range per grapheme cluster, so a break inside a "word" (after a hyphen, say) shows up as a line change too
    type Cur = { text: string; first: string; sp: boolean; x0: number; y0: number; x1: number; y1: number };
    let cur: Cur | null = null;
    let n = 0;
    const flush = () => {
      if (cur) out.push({ key, n: n++, text: cur.text, first: cur.first, x0: cur.x0, y0: cur.y0, x1: cur.x1, y1: cur.y1 });
      cur = null;
    };
    let space = false;
    for (const g of new Intl.Segmenter("ta", { granularity: "grapheme" }).segment(tn.data)) {
      const at = g.index;
      const pos = at + g.segment.length;
      if (/^\s+$/.test(g.segment)) { space = true; continue; }
      const r = document.createRange();
      r.setStart(tn, at);
      r.setEnd(tn, pos);
      const b = r.getClientRects()[0];
      if (!b) continue;
      const box = { x0: (b.left - pr.left) / k, y0: (b.top - pr.top) / k, x1: (b.right - pr.left) / k, y1: (b.bottom - pr.top) / k };
      if (cur && Math.abs(box.y0 - cur.y0) > (box.y1 - box.y0) * 0.4) flush();
      if (!cur) cur = { text: "", first: "", sp: false, ...box };
      if (space && cur.text) { cur.text += " "; cur.sp = true; }
      space = false;
      cur.text += g.segment;
      if (!cur.sp) cur.first += g.segment;
      cur.x0 = Math.min(cur.x0, box.x0);
      cur.x1 = Math.max(cur.x1, box.x1);
      cur.y1 = Math.max(cur.y1, box.y1);
    }
    flush();
  }
  return out;
}

export interface SpaceStat {
  /** Column width in px (canvas). */
  col: number;
  /** Mean word gap of the line / the natural space of the font (1 = no stretching). */
  growth: number;
  /** Characters on the line, spaces included. */
  chars: number;
  /** Unused part of the line, 0..1 of the column (ragged-right look). */
  rag: number;
}
/**
 * How the body text sits in its columns: for every line of every body paragraph except the last line of a paragraph,
 * the word-space growth (justified text stretches spaces to fill the line), the characters per line and the rag.
 * Self-contained (serialised into Chromium); call after domReady().
 */
export function domSpaceStats(): SpaceStat[] {
  const out: SpaceStat[] = [];
  document.querySelectorAll<HTMLElement>(".body").forEach((b) => {
    const cs = getComputedStyle(b);
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;white-space:pre;visibility:hidden";
    probe.style.font = cs.font;
    probe.style.fontVariationSettings = cs.fontVariationSettings;
    probe.style.fontFeatureSettings = cs.fontFeatureSettings;
    b.appendChild(probe);
    probe.textContent = "அ அ";
    const w2 = probe.getBoundingClientRect().width;
    probe.textContent = "அஅ";
    const space = w2 - probe.getBoundingClientRect().width;
    b.removeChild(probe);
    const n = parseInt(cs.columnCount, 10) || 1;
    const col = (b.offsetWidth - (parseFloat(cs.columnGap) || 0) * (n - 1)) / n;
    const k = b.getBoundingClientRect().width / b.offsetWidth; // transform scale
    b.querySelectorAll("p").forEach((p) => {
      const tn = p.firstChild as Text | null;
      if (!tn) return;
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      const lines: { x0: number; x1: number; top: number; len: number }[][] = [];
      while ((m = re.exec(tn.data))) {
        const r = document.createRange();
        r.setStart(tn, m.index);
        r.setEnd(tn, m.index + m[0].length);
        const c = r.getClientRects()[0]!;
        const w = { x0: c.left / k, x1: c.right / k, top: Math.round(c.top / k), len: m[0].length };
        const l = lines[lines.length - 1];
        if (l && Math.abs(l[0]!.top - w.top) < 4 && w.x0 >= l[l.length - 1]!.x0) l.push(w);
        else lines.push([w]);
      }
      lines.forEach((l, i) => {
        if (i === lines.length - 1 || l.length < 2) return;
        const gaps = l.slice(1).map((w, j) => w.x0 - l[j]!.x1);
        out.push({
          col: Math.round(col),
          growth: gaps.reduce((a, g) => a + g, 0) / gaps.length / space,
          chars: l.reduce((a, w) => a + w.len, 0) + l.length - 1,
          rag: (col - (l[l.length - 1]!.x1 - l[0]!.x0)) / col,
        });
      });
    });
  });
  return out;
}
