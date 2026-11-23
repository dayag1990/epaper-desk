// Tamil typography decisions, measured in real Chromium on the planned 8 pages (no photos): justified or left-aligned, column measure,
// hyphenation, axes, and that every context gets the same font CSS. Numbers are printed; docs/tamil-typography.md quotes them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Article } from "@epaper/core";
import { LayoutEngine, paperCss, SERVER_FONT_BASE, type PlanResult, type SpaceStat } from "../../packages/layout/dist/index.js";
import { ingestTamil, planTamil, taTemplates } from "./lib/tamil.js";

let eng: LayoutEngine, arts: Article[], plan: PlanResult;
const stats: Record<string, SpaceStat[]> = { left: [], justify: [] };
const q = (xs: number[], f: number) => [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))]!;

beforeAll(async () => {
  eng = await LayoutEngine.launch();
  arts = await ingestTamil();
  plan = await planTamil(eng, arts);
  for (const p of plan.pages) {
    await eng.load(p.fit.doc, p.template, arts);
    stats.left!.push(...(await eng.spaceStats("")));
    stats.justify!.push(...(await eng.spaceStats(".body{text-align:justify!important}")));
  }
}, 240_000);
afterAll(async () => { await eng?.close(); });

describe("justified or left-aligned (measured)", () => {
  it("justified Tamil stretches word spaces far too much in these columns; the template is left-aligned", () => {
    const g = stats.justify!.map((s) => s.growth);
    const worse2 = g.filter((x) => x > 2).length / g.length;
    const worse15 = g.filter((x) => x > 1.5).length / g.length;
    console.log(`JUSTIFIED: ${g.length} lines, mean word-space growth ${(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2)}x, median ${q(g, 0.5).toFixed(2)}x, p90 ${q(g, 0.9).toFixed(2)}x, max ${Math.max(...g).toFixed(1)}x, lines worse than 2x normal space ${(worse2 * 100).toFixed(1)}%, worse than 1.5x ${(worse15 * 100).toFixed(1)}%`);
    for (const col of [...new Set(stats.justify!.map((s) => s.col))].sort((a, b) => a - b)) {
      const c = stats.justify!.filter((s) => s.col === col).map((s) => s.growth);
      if (c.length > 15) console.log(`  column ${col}px: ${c.length} lines, mean ${(c.reduce((a, b) => a + b, 0) / c.length).toFixed(1)}x, max ${Math.max(...c).toFixed(1)}x, > 2x on ${(c.filter((x) => x > 2).length / c.length * 100).toFixed(0)}%`);
    }
    const rag = stats.left!.map((s) => s.rag);
    console.log(`LEFT-ALIGNED: ${rag.length} lines, word space = normal (1.00x), ragged edge: mean ${(rag.reduce((a, b) => a + b, 0) / rag.length * 100).toFixed(1)}% of the column, p90 ${(q(rag, 0.9) * 100).toFixed(1)}%`);
    expect(worse2).toBeGreaterThan(0.5); // the reason justified was rejected
    for (const t of taTemplates()) expect(paperCss(t)).toMatch(/\.body\{[^}]*text-align:left/);
    expect(Math.max(...stats.left!.map((s) => Math.abs(s.growth - 1)))).toBeLessThan(0.02); // left-aligned: spaces are the font's own
  });

  it("the narrowest body column has at least 24 characters per line on average", () => {
    const cols = [...new Set(stats.left!.map((s) => s.col))].sort((a, b) => a - b);
    const narrow = stats.left!.filter((s) => s.col === cols[0]!);
    const mean = narrow.reduce((a, s) => a + s.chars, 0) / narrow.length;
    console.log(`columns on the planned pages: ${cols.join(", ")} px; narrowest ${cols[0]} px has ${mean.toFixed(1)} characters per line on average (${narrow.length} lines)`);
    expect(narrow.length).toBeGreaterThan(30);
    expect(mean).toBeGreaterThanOrEqual(24);
  });
});

describe("one CSS for every context", () => {
  const t = taTemplates()[0]!;
  it("declares both families with explicit weight and stretch ranges, block display, and the same face list in editor and server CSS", () => {
    const editor = paperCss(t, { fontBase: "https://api.example/fonts" });
    const server = paperCss(t, { fontBase: SERVER_FONT_BASE });
    for (const css of [editor, server]) {
      expect(css).toContain('@font-face{font-family:"Noto Serif Tamil"');
      expect(css).toContain('@font-face{font-family:"Anek Tamil"');
      expect((css.match(/font-weight:100 900;font-stretch:75% 125%;font-display:block/g) ?? []).length).toBe(2);
      expect(css).toContain("NotoSerifTamil%5Bwdth%2Cwght%5D.ttf");
    }
    // apart from the font base the two stylesheets are identical
    expect(editor.replaceAll("https://api.example/fonts", "BASE")).toBe(server.replaceAll(SERVER_FONT_BASE, "BASE"));
  });

  it("sets hyphenation off, strict line breaking, explicit axes and feature settings", () => {
    const css = paperCss(t);
    expect(css).toMatch(/hyphens:none;-webkit-hyphens:none;line-break:strict;word-break:normal;overflow-wrap:normal/);
    expect(css).toContain('font-variation-settings:"wght" 400,"wdth" 100');
    expect(css).toContain('font-variation-settings:"wght" 800,"wdth" 100');
    expect(css).toContain('font-feature-settings:"ccmp" 1,"locl" 1,"kern" 1,"liga" 1');
    expect(css).toContain("transform:scale(var(--z,1))");
    expect(css).not.toMatch(/zoom:/);
    for (const x of taTemplates()) { expect(x.fonts.body).toMatch(/^"Noto Serif Tamil"/); expect(x.fonts.head).toMatch(/^"Anek Tamil"/); expect(x.lang).toBe("ta"); }
  });
});
