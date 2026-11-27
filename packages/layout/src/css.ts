import { isRuled, panelTint, type Template } from "./template.js";

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
.mast .name{font-family:${t.fonts.head};font-weight:800;font-size:${t.masthead_px.name}px;line-height:1.05;letter-spacing:-1px;min-width:200px;white-space:nowrap}
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
${furnitureCss(t)}${isRuled(t) ? ruledCss(t) : ""}
${t.css_extra}`;
}

/**
 * Furniture every template gets (nothing here changes a page that has no byline, jump line, cut-out or drop cap):
 * byline, jump lines, the cut-out photo with text wrap, the drop cap and the run-in dateline.
 */
function furnitureCss(t: Template): string {
  const lines = t.finish?.dropcap_lines ?? 3;
  return `
/* ---------- newspaper furniture ---------- */
.byline{font-size:15px;font-weight:700;line-height:1.35;margin:0 0 9px}
.byline:empty{display:none}
.byline[data-dl]::after{content:attr(data-dl);font-weight:500;margin-left:.6em;font-variant-caps:all-small-caps}
.byline[data-dl]:empty::after{margin-left:0}
.jump{font-size:14px;font-style:italic;line-height:1.3;color:#4a463e}
.jump.to{text-align:right;margin:5px 0 0}
.jump.from{margin:0 0 6px}
.body p[data-dl]::before{content:attr(data-dl) " ";font-weight:700;font-variant-caps:all-small-caps}
:lang(en) .body p[data-dl]::before{letter-spacing:.04em}
.body .dc{float:left;font-family:${t.fonts.head};font-weight:800;font-size:calc(var(--fs) * ${(lines * 1.62 * 0.96 / 0.7).toFixed(2)});line-height:.78;margin:.06em .1em -.06em 0;padding:0;text-indent:0;color:var(--red)}
.fig.cutout{float:left;width:calc(var(--cw,88%) + 10px);margin:0 12px 6px -10px;aspect-ratio:auto;background:none;overflow:visible;shape-margin:7px}
.fig.cutout img{width:100%;height:auto;object-fit:fill;display:block}
.fig.cutout.has-cap{margin-bottom:0}
.cap.cutcap{float:left;clear:left;width:calc(var(--cw,88%) + 10px);margin:0 12px 8px -10px}
.body [data-noedit]{user-select:none;-webkit-user-select:none}
.story.has-cut .body p:first-of-type{text-indent:0}`;
}

/**
 * The ruled style: print-newspaper rules and blocks, all drawn from colors.rule (and the template's tint).
 * Hairlines between columns and between stories, a heavy rule above the lead, a double rule under the masthead,
 * the header band of an inner page, boxed brief / pull quote / tinted panel.
 */
function ruledCss(t: Template): string {
  const f = t.finish!;
  const cg = t.gap.col_px;
  return `
/* ---------- ruled style (template.finish) ---------- */
.page.ruled{--hair:${f.hair_px}px;--heavy:${f.heavy_px}px;--tint:${panelTint(t)};--cg:${cg}px}
.ruled .mast{margin-bottom:7px}
.ruled .strip{border-top:var(--heavy) double var(--rule);border-bottom:var(--hair) solid var(--rule);margin:0 0 20px;padding:7px 4px 6px}
.ruled .strip.inner{border-top:var(--heavy) double var(--rule);margin-top:0;align-items:baseline}
.ruled .strip.inner .sec{color:var(--ink);font-size:30px;letter-spacing:0;text-transform:uppercase}
.ruled .strip.inner .folio{font-family:${t.fonts.head};font-weight:800;font-size:24px;border:var(--hair) solid var(--rule);padding:0 12px;line-height:1.5}
.ruled .grid{align-items:stretch}
.ruled .story{border-top:var(--hair) solid var(--rule);padding-top:10px}
.ruled .story.lead{border-top:var(--heavy) solid var(--rule)}
.ruled .story:not(.rs)::before{content:"";position:absolute;left:calc(var(--cg) / -2);top:0;bottom:0;width:var(--hair);background:var(--rule)}
.ruled .head,.ruled .story:nth-child(3n+1) .head,.ruled .story:nth-child(3n) .head{color:var(--ink)}
.ruled .kicker{display:block;background:none;color:var(--red);padding:0;margin:0 0 5px;font-size:17px;font-weight:800;text-transform:uppercase}
:lang(en) .ruled .kicker,.ruled:lang(en) .kicker{letter-spacing:.09em}
.ruled .sub{border-left:0;padding-left:0;font-weight:500;font-size:19px;line-height:1.38;margin:0 0 8px}
.ruled .byline{text-transform:uppercase;font-size:14px;margin:2px 0 10px;padding-top:6px;border-top:var(--hair) solid var(--rule)}
:lang(en) .ruled .byline,.ruled:lang(en) .byline{letter-spacing:.07em}
.ruled .cap{border-top:var(--hair) solid var(--rule);padding-top:4px}
.ruled .body{column-rule:var(--hair) solid var(--rule)}
.ruled .jump{border-top:var(--hair) solid var(--rule);padding-top:4px}
.ruled .k-side,.ruled .k-edit{background:none;padding:10px 0 0;border-top:var(--hair) solid var(--rule)}
.ruled .k-edit .kicker{font-size:17px;background:none}
.ruled .k-side .head{color:var(--ink)!important}
.ruled .k-ad{border-top:0;padding-top:0}
.ruled .k-ad::before{display:none}
/* boxed brief: a rule all round a short story */
.ruled .b-brief{border:calc(var(--hair) * 2) solid var(--rule);padding:12px 14px 14px}
.ruled .b-brief::before{display:none}
.ruled .b-brief .head{font-size:calc(min(18px + var(--span,2) * 3px, 34px) * var(--hs,1))}
/* tinted panel: the template's own tint behind the story */
.ruled .b-panel{background:var(--tint);padding:12px 14px 14px;border-top:var(--heavy) solid var(--rule)}
.ruled .b-panel::before{display:none}
/* pull quote: big quote mark, a rule above and below, centred, spans the columns it is given */
.ruled .b-quote{border-top:var(--heavy) solid var(--rule);border-bottom:var(--heavy) solid var(--rule);padding:14px 22px 16px;text-align:center}
.ruled .b-quote .kicker,.ruled .b-quote .byline,.ruled .b-quote .body,.ruled .b-quote .jump,.ruled .b-quote .fig,.ruled .b-quote .cap{display:none}
.ruled .b-quote .head{font-style:italic;font-weight:700;font-size:calc(min(24px + var(--span,2) * 4px, 52px) * var(--hs,1));line-height:1.22;color:var(--ink);margin:0 0 8px}
.ruled .b-quote .head::before{content:"\\201C";display:block;font-style:normal;font-weight:800;color:var(--red);font-size:2.6em;line-height:.62;height:.5em;margin-bottom:.12em}
.ruled .b-quote .sub{border:0;padding:0;font-size:16px;font-weight:700;text-transform:uppercase;margin:0}
:lang(en) .ruled .b-quote .sub,.ruled:lang(en) .b-quote .sub{letter-spacing:.07em}
.ruled .b-quote .sub::before{content:"\\2014\\00a0"}
`;
}
