import sharp from "sharp";

/** Rule-based cut-out (no AI, no model). Outline points and boxes are 0-1 fractions of the image. */
export type Point = [number, number];
export interface SubjectBox { x: number; y: number; w: number; h: number }
export interface CutoutResult {
  provider: string;
  /** PNG with alpha (original orientation and size). Null when the provider could not run. */
  png: Buffer | null;
  subjectBox: SubjectBox | null;
  /** Simplified polygon for CSS shape-outside / clip-path, 0-1 fractions. */
  outline: Point[];
  /** 0-1. Below LOW_CONFIDENCE the editor should offer the manual crop. */
  confidence: number;
  low: boolean;
  /** Plain-words note for the editor. */
  message: string;
  /** Set when low: the rule path that always works. */
  fallback: "manual-crop" | null;
}

/** Wire 4: one interface, several providers. The rule provider below is the default; AI/SEG plugs in later, OFF by default. */
export interface CutoutProvider {
  readonly name: string;
  cut(image: Buffer): Promise<CutoutResult>;
}

export const LOW_CONFIDENCE = 0.55;
const WORK_PX = 640;

// ---------- colour ----------
function srgbToLab(r: number, g: number, b: number, out: Float32Array, o: number): void {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  out[o] = 116 * fy - 16; out[o + 1] = 500 * (fx - fy); out[o + 2] = 200 * (fy - fz);
}
const dE = (a: Float32Array, i: number, b: Float32Array, j: number) => {
  const l = a[i] - b[j], x = a[i + 1] - b[j + 1], y = a[i + 2] - b[j + 2];
  return Math.sqrt(l * l + x * x + y * y);
};

// ---------- mask helpers ----------
function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (m[i] && m[i - 1] && m[i + 1] && m[i - w] && m[i + w] && m[i - w - 1] && m[i - w + 1] && m[i + w - 1] && m[i + w + 1]) o[i] = 1;
  }
  return o;
}
function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w]) ||
      (x > 0 && y > 0 && m[i - w - 1]) || (x < w - 1 && y > 0 && m[i - w + 1]) || (x > 0 && y < h - 1 && m[i + w - 1]) || (x < w - 1 && y < h - 1 && m[i + w + 1])) o[i] = 1;
  }
  return o;
}
/** Label 4-connected components of m; returns labels (0 = none) and sizes (index = label). */
function components(m: Uint8Array, w: number, h: number): { lab: Int32Array; sizes: number[] } {
  const lab = new Int32Array(m.length);
  const sizes = [0];
  const q = new Int32Array(m.length);
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue;
    const id = sizes.length;
    let head = 0, tail = 0, n = 0;
    q[tail++] = s; lab[s] = id;
    while (head < tail) {
      const p = q[head++]; n++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; q[tail++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; q[tail++] = p + 1; }
      if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; q[tail++] = p - w; }
      if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; q[tail++] = p + w; }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

/** Moore-neighbour outer boundary trace of the set where lab === id. Returns pixel corners path. */
function traceOuter(lab: Int32Array, id: number, w: number, h: number): Point[] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === id ? 1 : 0);
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) { sx = x; sy = y; break outer; }
  if (sx < 0) return [];
  const dx = [1, 1, 0, -1, -1, -1, 0, 1], dy = [0, 1, 1, 1, 0, -1, -1, -1];
  const pts: Point[] = [[sx, sy]];
  let cx = sx, cy = sy, dir = 6; // arrived heading "up": start search from west-ish
  let guard = 0;
  do {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // start 90deg counter to last move
      const nx = cx + dx[d], ny = cy + dy[d];
      if (at(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break; }
    }
    if (!found) break; // single pixel
    pts.push([cx, cy]);
  } while ((cx !== sx || cy !== sy) && ++guard < w * h * 4);
  return pts;
}

function rdp(p: Point[], eps: number): Point[] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let md = 0, mi = -1;
    const [ax, ay] = p[a], [bx, by] = p[b];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - p[i][1]) - (ax - p[i][0]) * (by - ay)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}

function simplifyClosed(pts: Point[], eps: number, maxPts: number): Point[] {
  if (pts.length < 4) return pts;
  const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
  // split at the farthest point so the ring simplifies stably
  let fi = 0, fd = -1;
  for (let i = 0; i < closed.length; i++) { const d = Math.hypot(closed[i][0] - closed[0][0], closed[i][1] - closed[0][1]); if (d > fd) { fd = d; fi = i; } }
  const a = closed.slice(0, fi + 1), b = [...closed.slice(fi), closed[0]];
  let e = eps, out: Point[] = [];
  for (let t = 0; t < 12; t++) {
    out = [...rdp(a, e).slice(0, -1), ...rdp(b, e).slice(0, -1)];
    if (out.length <= maxPts) break;
    e *= 1.4;
  }
  return out;
}

// ---------- the rule provider ----------
export interface RuleCutoutOptions {
  /** Lab distance a pixel may differ from the background palette. */
  tolerance?: number;
  /** Lab distance allowed between a pixel and the background pixel it is reached from (follows gentle gradients). */
  stepTolerance?: number;
  maxOutlinePoints?: number;
  featherSigma?: number;
}

export class RuleCutoutProvider implements CutoutProvider {
  readonly name = "rule-floodfill";
  constructor(private readonly o: RuleCutoutOptions = {}) {}

  async cut(image: Buffer): Promise<CutoutResult> {
    const tol = this.o.tolerance ?? 12, stepTol = this.o.stepTolerance ?? 4;
    // full-size, oriented, sRGB, flattened onto white for analysis
    const oriented = await sharp(image).rotate().toColorspace("srgb").toBuffer({ resolveWithObject: true });
    const fullW = oriented.info.width, fullH = oriented.info.height;
    const scale = Math.min(1, WORK_PX / Math.max(fullW, fullH));
    const w = Math.max(3, Math.round(fullW * scale)), h = Math.max(3, Math.round(fullH * scale));
    const raw = await sharp(oriented.data).flatten({ background: "#ffffff" }).resize(w, h, { fit: "fill", kernel: "lanczos3" }).removeAlpha().raw().toBuffer();
    const n = w * h;
    const lab = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) srgbToLab(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2], lab, i * 3);

    // border palette: greedy clusters, keep those holding a real share of the border
    const border: number[] = [];
    for (let x = 0; x < w; x++) { border.push(x, (h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { border.push(y * w, y * w + w - 1); }
    const cl: { c: Float32Array; n: number }[] = [];
    for (const p of border) {
      let hit = false;
      for (const k of cl) {
        const l = k.c[0] - lab[p * 3], a = k.c[1] - lab[p * 3 + 1], b = k.c[2] - lab[p * 3 + 2];
        if (Math.sqrt(l * l + a * a + b * b) < tol) { k.n++; hit = true; break; }
      }
      if (!hit && cl.length < 24) cl.push({ c: Float32Array.of(lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]), n: 1 });
    }
    cl.sort((a, b) => b.n - a.n);
    const pal = cl.filter((k, i) => i === 0 || k.n >= border.length * 0.06);
    const palC = new Float32Array(pal.length * 3);
    pal.forEach((k, i) => palC.set(k.c, i * 3));
    const palDist = (p: number) => {
      let m = Infinity;
      for (let k = 0; k < pal.length; k++) { const d = dE(lab, p * 3, palC, k * 3); if (d < m) m = d; }
      return m;
    };
    const palShare = pal.reduce((s, k) => s + k.n, 0) / border.length;

    // edge-connected flood fill
    const bg = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    for (const p of border) if (!bg[p] && palDist(p) < tol) { bg[p] = 1; q[tail++] = p; }
    const seeds = tail;
    while (head < tail) {
      const p = q[head++];
      const x = p % w;
      const tryN = (r: number) => {
        if (bg[r]) return;
        if (dE(lab, r * 3, lab, p * 3) < stepTol && palDist(r) < tol * 1.6) { bg[r] = 1; q[tail++] = r; }
      };
      if (x > 0) tryN(p - 1);
      if (x < w - 1) tryN(p + 1);
      if (p >= w) tryN(p - w);
      if (p < n - w) tryN(p + w);
    }

    // foreground, cleanup: open (drop specks/hairlines), close (fill pin holes), keep the dominant blob(s)
    let fg = new Uint8Array(n);
    for (let i = 0; i < n; i++) fg[i] = bg[i] ? 0 : 1;
    fg = dilate(erode(fg, w, h), w, h);
    fg = erode(dilate(fg, w, h), w, h);
    let { lab: cc, sizes } = components(fg, w, h);
    let big = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > (sizes[big] ?? 0)) big = i;
    const keepMin = (sizes[big] ?? 0) * 0.08;
    for (let i = 0; i < n; i++) if (fg[i] && sizes[cc[i]] < keepMin) fg[i] = 0;
    // fill interior holes (background-like regions not touching the border stay subject)
    const inv = new Uint8Array(n);
    for (let i = 0; i < n; i++) inv[i] = fg[i] ? 0 : 1;
    const holes = components(inv, w, h);
    const touching = new Set<number>();
    for (const p of border) if (inv[p]) touching.add(holes.lab[p]);
    for (let i = 0; i < n; i++) if (inv[i] && !touching.has(holes.lab[i])) fg[i] = 1;
    ({ lab: cc, sizes } = components(fg, w, h));
    big = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > (sizes[big] ?? 0)) big = i;

    const fgCount = fg.reduce((s, v) => s + v, 0);
    const frac = fgCount / n;

    // confidence from observable signals
    let fgOnBorder = 0;
    for (const p of border) if (fg[p]) fgOnBorder++;
    const edgeFg = fgOnBorder / border.length;
    const domin = fgCount ? (sizes[big] ?? 0) / fgCount : 0;
    // edge crispness: fraction of boundary pixels where the colour change across the edge is clear
    let bnd = 0, crisp = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (fg[i] && (!fg[i - 1] || !fg[i + 1] || !fg[i - w] || !fg[i + w])) {
        bnd++;
        const o = !fg[i - 1] ? i - 1 : !fg[i + 1] ? i + 1 : !fg[i - w] ? i - w : i + w;
        if (dE(lab, i * 3, lab, o * 3) > 8) crisp++;
      }
    }
    const crispness = bnd ? crisp / bnd : 0;
    const sizeScore = frac < 0.02 ? frac / 0.02 : frac > 0.8 ? Math.max(0, (0.97 - frac) / 0.17) : 1;
    const confidence = Math.max(0, Math.min(1,
      Math.min(1, palShare / 0.8) * 0.3 + (1 - Math.min(1, edgeFg * 4)) * 0.2 + sizeScore * 0.2 + crispness * 0.2 + domin * 0.1));
    const low = confidence < LOW_CONFIDENCE || fgCount === 0 || seeds === 0;

    if (fgCount === 0 || seeds === 0) {
      return { provider: this.name, png: null, subjectBox: null, outline: [], confidence: Math.min(confidence, 0.1), low: true, fallback: "manual-crop",
        message: "No clear subject found on a plain background. Use the manual crop for this photo." };
    }

    // outline polygon (largest blob) in 0-1
    const ring = traceOuter(cc, big, w, h);
    const simp = simplifyClosed(ring, 1.4, this.o.maxOutlinePoints ?? 48);
    const outline: Point[] = simp.map(([x, y]) => [round4((x + 0.5) / w), round4((y + 0.5) / h)]);
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fg[y * w + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const subjectBox: SubjectBox = { x: round4(minX / w), y: round4(minY / h), w: round4((maxX - minX + 1) / w), h: round4((maxY - minY + 1) / h) };

    // feathered alpha at working size, scaled up to full size, joined to the oriented original
    const a8 = Buffer.alloc(n);
    for (let i = 0; i < n; i++) a8[i] = fg[i] ? 255 : 0;
    const alpha = await sharp(a8, { raw: { width: w, height: h, channels: 1 } })
      .blur(this.o.featherSigma ?? 1.1)
      .resize(fullW, fullH, { fit: "fill", kernel: "cubic" })
      .extractChannel(0).raw().toBuffer();
    const rgb = await sharp(oriented.data).removeAlpha().raw().toBuffer();
    const rgba = Buffer.alloc(fullW * fullH * 4);
    for (let i = 0, j = 0, k = 0; i < fullW * fullH; i++, j += 3, k += 4) {
      rgba[k] = rgb[j]; rgba[k + 1] = rgb[j + 1]; rgba[k + 2] = rgb[j + 2]; rgba[k + 3] = alpha[i];
    }
    const png = await sharp(rgba, { raw: { width: fullW, height: fullH, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer();

    return {
      provider: this.name, png, subjectBox, outline, confidence: round4(confidence), low,
      fallback: low ? "manual-crop" : null,
      message: low
        ? "The background is too busy for an automatic cut-out, so the result may be rough. Use the manual crop to outline the subject."
        : "Cut-out ready. Check the edges; the manual crop is still available.",
    };
  }
}
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Alpha channel of a cut-out PNG as a flat Uint8Array (for tests and previews). */
export async function alphaOf(png: Buffer): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
