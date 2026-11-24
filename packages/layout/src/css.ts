import type { Template } from "./template.js";

/** Where the editor (same origin as the API) fetches the template fonts from. The server render passes its own base (see fonts.ts). */
export const DEFAULT_FONT_BASE = "/fonts";
export interface CssOptions {
  /** URL prefix the font files are served under; the face `src` is appended to it. */
  fontBase?: string;
}

const FORMAT: Record<string, string> = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };
const fontUrl = (src: string, base: string): string =>
  /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(src) ? src : `${base.replace(/\/$/, "")}/${src.split("/").map(encodeURIComponent).join("/")}`;

/** The paperCss style of the prototype, parameterised by template tokens. Same CSS for editor and server. */
export function paperCss(t: Template, opts: CssOptions = {}): string {
  const c = t.colors;
  const base = opts.fontBase ?? DEFAULT_FONT_BASE;
  // font-display:block: text is never set in a fallback font, so nothing is measured with the wrong face.
  const faces = t.fonts.faces
    .map((f) => {
      const ext = f.src.split(".").pop()!.toLowerCase();
      return `@font-face{font-family:"${f.family}";src:url("${fontUrl(f.src, base)}") format("${f.format ?? FORMAT[ext] ?? "truetype"}");${f.weight ? `font-weight:${f.weight};` : ""}${f.stretch ? `font-stretch:${f.stretch};` : ""}font-display:block}`;
    })
    .join("\n");
  return `${faces}
/* ---------- newspaper page (shared by editor and server) ---------- */
.page{--ink:${c.ink};--red:${c.red};--blue:${c.blue};--rule:${c.rule};--mast:${c.mast};--fs:${t.body.default_px}px;
  width:${t.canvas_px}px;box-sizing:border-box;padding:${t.pad.top}px ${t.pad.right}px ${t.pad.bottom}px ${t.pad.left}px;background:${c.paper};color:var(--ink);
  font-family:${t.fonts.body};
  /* no hyphenation in any script, and the same line-breaking rules in every context */
  hyphens:none;-webkit-hyphens:none;line-break:strict;word-break:normal;overflow-wrap:normal}
.page *{box-sizing:border-box}
.mast{background:var(--mast);color:#fff;padding:18px 28px 12px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.mast .name{font-family:${t.fonts.head};font-weight:800;font-size:${t.masthead_px.name}px;line-height:1.05;letter-spacing:-1px;min-width:200px}
.mast .tag{font-size:${t.masthead_px.tag}px;font-weight:600;text-align:right;line-height:1.5;opacity:.95;min-width:120px}
.strip{display:flex;justify-content:space-between;gap:20px;border-bottom:4px solid var(--rule);border-top:1px solid var(--rule);
  padding:7px 4px;margin:6px 0 20px;font-size:15px;font-weight:700;letter-spacing:.3px}
.strip.inner{border-top:4px solid var(--red);margin-top:0}
.strip .sec{font-family:${t.fonts.head};font-size:30px;font-weight:800;color:var(--red);line-height:1.2}
.grid{display:grid;grid-template-columns:repeat(${t.columns},minmax(0,1fr));gap:${t.gap.row_px}px ${t.gap.col_px}px;align-items:start}
.story{grid-column:span var(--span,2);border-top:3px solid var(--rule);padding-top:10px;min-width:0;position:relative}
.kicker{display:inline-block;background:var(--red);color:#fff;font-weight:700;font-size:20px;padding:4px 14px 2px;margin:0 0 8px}
.head{font-family:${t.fonts.head};font-weight:800;margin:0 0 6px;line-height:1.24;
  font-size:calc(min(20px + var(--span,2) * 5.5px, 58px) * var(--hs,1))}
.story:nth-child(3n+1) .head{color:var(--red)}
.story:nth-child(3n) .head{color:var(--blue)}
.sub{font-weight:700;font-size:18px;line-height:1.4;margin:0 0 10px;padding-left:10px;border-left:5px solid var(--red)}
.fig{margin:4px 0 12px;aspect-ratio:var(--ar,1.78);background:#e6e2d6;overflow:hidden;position:relative}
.fig img{width:100%;height:100%;object-fit:cover;display:block}
.fig.has-cap{margin-bottom:5px}
.cap{font-size:12px;line-height:1.4;color:#3d3a33;margin:0 0 12px}
.cap .credit{font-size:10px;color:#6a665c;font-weight:400}
.body{columns:var(--cols,2);column-gap:${t.body.col_gap_px}px;column-rule:1px solid #cfcabd;font-size:var(--fs);line-height:${t.body.line_height};text-align:justify}
.body p{margin:0 0 .45em;widows:2;orphans:2}
.body p+p{text-indent:1.2em}
.k-side{background:#fff3c4;padding:12px 14px 14px;border-top:6px solid var(--red)}
.k-side .head{color:var(--red)!important}
.k-feature .head{color:var(--ink)!important}
.k-edit{background:#eef2fb;padding:12px 16px 16px;border-top:6px solid var(--blue)}
.k-edit .kicker{background:var(--blue);font-size:26px}
.k-ad{border-top:0;padding-top:0}
.k-ad .fig{margin:0;border:1px solid #999}
/* Zoom is a transform, never CSS zoom or a font-size change: the page is always LAID OUT on the template canvas (1520 px wide),
   so line breaks and the fill % are the same at every editor zoom and in the PDF. Whoever shows the page at another size
   gives its host element the scaled width and height (the editor does; the print sheet does, see export/pdf.ts). */
.page{transform:scale(var(--z,1));transform-origin:0 0}
.fig .warn{position:absolute;left:8px;top:8px;background:#e11d2e;color:#fff;font:800 13px system-ui,sans-serif;padding:4px 8px;border-radius:4px}
.fig.empty{border:3px dashed #8d8777;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  font:800 17px/1.5 system-ui,sans-serif;color:#5c5648;padding:10px}
.fig.empty small{display:block;font-weight:600;font-size:14px;color:#7a7465}
[data-ph]:empty::before{content:attr(data-ph);color:#9a9a9a;font-weight:500}
.mast [data-ph]:empty::before{color:rgba(255,255,255,.6)}
${t.css_extra}`;
}
