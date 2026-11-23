import type { Template } from "./template.js";

/** The paperCss style of the prototype, parameterised by template tokens. Same CSS for editor and server. */
export function paperCss(t: Template): string {
  const c = t.colors;
  const faces = t.fonts.faces
    .map((f) => `@font-face{font-family:"${f.family}";src:url("${f.src}") format("woff2");${f.weight ? `font-weight:${f.weight};` : ""}font-display:block}`)
    .join("\n");
  return `${faces}
/* ---------- newspaper page (shared by editor and server) ---------- */
.page{--ink:${c.ink};--red:${c.red};--blue:${c.blue};--rule:${c.rule};--mast:${c.mast};--fs:${t.body.default_px}px;
  width:${t.canvas_px}px;box-sizing:border-box;padding:${t.pad.top}px ${t.pad.right}px ${t.pad.bottom}px ${t.pad.left}px;background:${c.paper};color:var(--ink);
  font-family:${t.fonts.body};}
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
.page{zoom:var(--z,1)}
.fig .warn{position:absolute;left:8px;top:8px;background:#e11d2e;color:#fff;font:800 13px system-ui,sans-serif;padding:4px 8px;border-radius:4px}
.fig.empty{border:3px dashed #8d8777;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  font:800 17px/1.5 system-ui,sans-serif;color:#5c5648;padding:10px}
.fig.empty small{display:block;font-weight:600;font-size:14px;color:#7a7465}
[data-ph]:empty::before{content:attr(data-ph);color:#9a9a9a;font-weight:500}
.mast [data-ph]:empty::before{color:rgba(255,255,255,.6)}
${t.css_extra}`;
}
