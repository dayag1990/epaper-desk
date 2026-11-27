import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LayoutSnapshotSchema } from "@epaper/core";
import { LayoutEngine, bylineText, datelineText, dropcapAllowed, firstGrapheme, paperCss, renderPage } from "../src/index.js";
import { tpl } from "./helpers.js";
import { showcase } from "./finish-fixture.js";

let eng: LayoutEngine;
beforeAll(async () => { eng = await LayoutEngine.launch(); }, 60000);
afterAll(async () => { await eng.close(); });

const at = (html: string, s: string) => html.indexOf(s);

describe("ruled style: furniture order and rules", () => {
  const { doc, template, articles } = showcase();
  const r = renderPage(doc, template, articles);
  const lead = r.html.slice(at(r.html, 'data-item="it_lead"'), at(r.html, 'data-item="it_brief"'));
  it("a ruled template puts the ruled class on the page; the prototype template does not", () => {
    expect(r.html).toContain('class="page ruled"');
    expect(renderPage(doc, tpl("prototype-pa", "inner_a"), articles).html).not.toContain("ruled");
  });
  it("kicker above the headline, deck below it, then the byline, then the text", () => {
    const order = ['class="kicker"', 'class="head"', 'class="sub"', 'class="byline"', 'class="body"'].map((s) => at(lead, s));
    expect(order.every((x) => x > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("byline text and dateline text are printed as the template says", () => {
    expect(datelineText("Riverton, 3 Nov")).toBe("Riverton, 3 Nov —");
    expect(datelineText("Riverton —")).toBe("Riverton —");
    expect(datelineText(null)).toBe("");
    expect(bylineText("Hannah Oakes", { finish: { byline_prefix: "By " } } as never)).toBe("By Hannah Oakes");
    expect(bylineText("By Hannah Oakes", { finish: { byline_prefix: "By " } } as never)).toBe("By Hannah Oakes");
  });
  it("the dateline runs into the first paragraph of a story without a drop cap, and joins the byline line when there is one", () => {
    const photo = r.html.slice(at(r.html, 'data-item="it_photo"'), at(r.html, 'data-item="it_from"'));
    expect(photo).toContain('<p data-dl="Riverton, 26 Nov —">');
    expect(lead).toContain('class="byline" data-dl="Riverton, 27 Nov —"');
    expect(lead).not.toContain("<p data-dl=");
  });
  it("the template colour drives the rules and the tint", () => {
    const css = paperCss(template);
    expect(css).toContain("--rule:" + template.colors.rule);
    expect(css).toContain("--tint:#");
    expect(css).toMatch(/\.ruled \.story\.lead\{border-top:var\(--heavy\) solid var\(--rule\)\}/);
    expect(css).toMatch(/\.ruled \.strip\{border-top:var\(--heavy\) double var\(--rule\)/);
    expect(css).toMatch(/\.ruled \.body\{column-rule:var\(--hair\) solid var\(--rule\)\}/);
    expect(paperCss(tpl("prototype-pa", "inner_a"))).not.toContain(".ruled");
  });
  it("only the first story is the lead, and each row starts a story without a gutter rule", () => {
    expect((r.html.match(/ lead[ "]/g) ?? []).length).toBe(1);
    expect(r.html).toContain('class="story k-story lead rs dc has-cut" data-item="it_lead"');
  });
  it("the folio follows the real page number, not the stored text", () => {
    const moved = { ...doc, page: { ...doc.page, no: 5 } };
    expect(renderPage(moved, template, articles).html).toContain(">PAGE 5<");
    expect(renderPage({ ...doc, furniture: { ...doc.furniture!, strip: ["NEWS", "DATE", "Sports desk"] } }, template, articles).html).toContain(">Sports desk<");
  });
});

describe("blocks", () => {
  const { doc, template, articles } = showcase();
  const html = renderPage(doc, template, articles).html;
  it("boxed brief, pull quote and tinted panel get their own class", () => {
    expect(html).toMatch(/class="story k-story b-brief[^"]*" data-item="it_brief"/);
    expect(html).toMatch(/class="story k-story b-quote[^"]*" data-item="it_quote"/);
    expect(html).toMatch(/class="story k-story b-panel[^"]*" data-item="it_panel"/);
  });
  it("a plain block carries no block class, and a missing flag loads as plain", () => {
    const d2 = { ...doc, items: doc.items.map((i) => { const { block: _b, ...rest } = i; return rest; }) };
    expect(renderPage(d2 as never, template, articles).html).not.toContain(" b-");
  });
  it("jump lines say where the story goes on and where it came from", () => {
    expect(html).toContain('<div class="jump to">Continued on page 3</div>');
    expect(html).toContain('<div class="jump from">Continued from page 1</div>');
  });
  it("Tamil and Punjabi templates have their own jump wording", () => {
    const ta = renderPage({ ...doc, page: { ...doc.page, template: "inner_a" } }, tpl("broadsheet-ta", "inner_a"), articles).html;
    expect(ta).toContain("தொடர்ச்சி: பக்கம் 3");
    expect(renderPage(doc, tpl("broadsheet-pa", "inner_a"), articles).html).toContain("ਪੰਨਾ 1 ਤੋਂ ਜਾਰੀ");
  });
});

describe("drop cap: grapheme based, only where the script looks right", () => {
  const en = tpl("broadsheet-en", "inner_a"), ta = tpl("broadsheet-ta", "inner_a"), pa = tpl("broadsheet-pa", "inner_a");
  it("splits on graphemes, not code points", () => {
    expect(firstGrapheme("école")).toBe("é");
    expect(firstGrapheme("கொயம்")).toBe("கொ"); // Tamil consonant + vowel sign stays whole
    expect(firstGrapheme("ਸਿੰਘ")).toBe("ਸਿੰ"); // Gurmukhi consonant + signs
  });
  it("Latin yes; Tamil and Gurmukhi no; quotes and digits no", () => {
    expect(dropcapAllowed("Riverton council", en)).toBe(true);
    expect(dropcapAllowed("கொயம்", ta)).toBe(false);
    expect(dropcapAllowed("ਸਿੰਘ", pa)).toBe(false);
    expect(dropcapAllowed("“Quoted", en)).toBe(false);
    expect(dropcapAllowed("1911 was", en)).toBe(false);
  });
  it("the renderer leaves a Tamil story without a drop cap even when the flag is set", () => {
    const { doc, articles } = showcase();
    const d = { ...doc, items: doc.items.map((i) => (i.id === "it_lead" ? { ...i, text: { ...i.text!, body: ["கொயம் " + "கொயம் ".repeat(40)] } } : i)) };
    const html = renderPage(d, ta, articles).html;
    expect(html).not.toContain('class="dc"');
    expect(renderPage(doc, en, articles).html).toContain('<span class="dc">T</span>he council');
  });
});

describe("cut-out photo wraps text around its outline (real Chromium)", () => {
  it("text enters the transparent corners of the figure; an opaque picture falls back to its rectangle; the figure overhangs the frame", async () => {
    const run = async (kind: "alpha" | "opaque") => {
      const { doc, template, articles } = showcase({ cutout: kind });
      await eng.load(doc, template, articles);
      return eng["page"].evaluate(() => {
        const box = document.querySelector<HTMLElement>(".cutbox")!, fig = box.querySelector<HTMLElement>(".fig.cutout")!, story = document.querySelector<HTMLElement>(".story")!;
        const fr = box.getBoundingClientRect(), sr = story.getBoundingClientRect();
        const p = document.querySelector(".body p")!;
        const tn = Array.from(p.childNodes).find((n) => n.nodeType === 3) as Text;
        let inCorner = 0, overlapRows = 0;
        const re = /\S+/g; let m: RegExpExecArray | null;
        while ((m = re.exec(tn.data))) {
          const r = document.createRange(); r.setStart(tn, m.index); r.setEnd(tn, m.index + m[0].length);
          const b = r.getClientRects()[0]!;
          const rowOverlap = b.bottom > fr.top && b.top < fr.bottom;
          if (rowOverlap) { overlapRows++; if (b.left < fr.right - 4 && b.right > fr.left) inCorner++; }
        }
        return { overhang: sr.left - fr.left, figW: fr.width, overlapRows, inCorner, shape: getComputedStyle(box).shapeOutside, capBelow: box.querySelector(".cap")!.getBoundingClientRect().top >= fig.getBoundingClientRect().bottom - 1 };
      });
    };
    const a = await run("alpha"), o = await run("opaque");
    expect(a.capBelow).toBe(true); // the caption is right under the photo
    expect(a.shape).toMatch(/^polygon\(/); // the outline read from the alpha channel
    expect(o.shape).not.toMatch(/^polygon\(/); // a solid picture: the rectangle
    expect(a.overhang).toBeGreaterThanOrEqual(5); // a few px into the gutter
    expect(a.overhang).toBeLessThanOrEqual(14);
    expect(a.overlapRows).toBeGreaterThan(10);
    expect(a.inCorner).toBeGreaterThan(0); // words sit INSIDE the figure's box: round the outline
    expect(o.inCorner).toBe(0); // no alpha: the rectangle is the shape
  }, 60000);
});

describe("D4 snapshot of the finish", () => {
  it("has byline, jump, box and rule frames, the drop cap, the dateline and a wrapped photo; and validates", async () => {
    const { doc, template, articles } = showcase();
    const snap = await eng.snapshot("ed_FINISH1", [{ doc, template }], articles);
    LayoutSnapshotSchema.parse(snap);
    const f = snap.pages[0]!.frames;
    const role = (r: string) => f.filter((x) => x.role === r);
    expect(role("byline").map((x) => x.item).sort()).toEqual(["it_lead", "it_photo"]);
    expect(role("byline").find((x) => x.item === "it_lead")!.text).toContain("RIVERTON".length ? "Riverton, 27 Nov" : "");
    expect(role("jump").map((x) => x.id).sort()).toEqual(["it_from.jump_from", "it_photo.jump_to"]);
    expect(role("box").map((x) => [x.item, x.block])).toEqual(expect.arrayContaining([["it_brief", "brief"], ["it_panel", "panel"]]));
    expect(role("box").find((x) => x.block === "panel")!.tint).toMatch(/^#[0-9a-f]{6}$/);
    expect(role("rule").some((x) => x.rule === "heavy" && x.item === "it_lead")).toBe(true);
    expect(role("rule").some((x) => x.rule === "double" && x.item === "it_furniture")).toBe(true);
    expect(role("rule").some((x) => x.id.endsWith(".rule_v") && x.w === 0 && x.h > 0)).toBe(true);
    expect(role("rule").filter((x) => x.item === "it_quote").length).toBe(2); // above and below
    expect(f.find((x) => x.id === "it_lead.body")).toMatchObject({ dropcap_lines: 3 });
    expect(f.find((x) => x.id === "it_photo.body")).toMatchObject({ dateline: "Riverton, 26 Nov —" });
    expect(f.find((x) => x.id === "it_lead.image")).toMatchObject({ wrap: "alpha" });
    expect(f.find((x) => x.item === "it_quote" && x.role === "body")).toBeUndefined(); // the quote block prints no body
    expect(f.find((x) => x.item === "it_lead" && x.role === "caption")!.text).toContain("Jane Doe");
  }, 60000);
});
