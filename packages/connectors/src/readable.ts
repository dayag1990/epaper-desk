import * as cheerio from "cheerio";

// Readability-style text density, by rules only. Paragraphs vote for their parent
// containers; class/id names push a container up or down; link-heavy containers lose.

const POS = /article|body|content|entry|post|story|text|main|page|prose/i;
const NEG = /comment|footer|foot|sidebar|side|nav|menu|share|social|related|promo|advert|\bad\b|banner|widget|popup|subscribe|newsletter|breadcrumb|meta|tags?\b/i;

export interface Scored { el: any; score: number }

function weight(el: any): number {
  const s = `${el.attribs?.class ?? ""} ${el.attribs?.id ?? ""}`;
  let w = 0;
  if (POS.test(s)) w += 25;
  if (NEG.test(s)) w -= 25;
  if (el.attribs?.itemprop === "articleBody") w += 60;
  const tag = el.name;
  if (tag === "article") w += 30;
  if (tag === "main") w += 10;
  if (tag === "aside" || tag === "nav" || tag === "footer" || tag === "header") w -= 50;
  return w;
}

export function scoreCandidates($: cheerio.CheerioAPI): Scored[] {
  const scores = new Map<any, number>();
  $("p").each((_, p) => {
    const text = $(p).text().trim();
    if (text.length < 25) return;
    const pts = 1 + (text.match(/[,،。।]/g)?.length ?? 0) + Math.min(Math.floor(text.length / 100), 3);
    const parent = (p as any).parent;
    if (!parent || parent.type !== "tag") return;
    for (const [el, f] of [[parent, 1], [parent.parent, 0.5]] as const) {
      if (!el || el.type !== "tag" || ["html", "body"].includes(el.name)) continue;
      scores.set(el, (scores.get(el) ?? 0) + pts * f);
    }
  });
  const out: Scored[] = [];
  for (const [el, s] of scores) {
    const total = $(el).text().length || 1;
    const linkText = $(el).find("a").text().length;
    const linkDensity = Math.min(linkText / total, 1);
    out.push({ el, score: (s + weight(el)) * (1 - linkDensity) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function readableElement($: cheerio.CheerioAPI): any | undefined {
  const best = scoreCandidates($);
  return best[0] && best[0].score > 0 ? best[0].el : undefined;
}

/** A short CSS selector that finds this element on the page (and ideally on its siblings' pages). */
export function selectorFor($: cheerio.CheerioAPI, el: any): string {
  const esc = (s: string) => s.replace(/([^\w-])/g, "\\$1");
  const tag = el.name;
  if (el.attribs?.itemprop === "articleBody") return `${tag}[itemprop=articleBody]`;
  if (el.attribs?.id && $(`#${esc(el.attribs.id)}`).length === 1 && !/\d{3,}/.test(el.attribs.id)) return `#${esc(el.attribs.id)}`;
  const classes = (el.attribs?.class ?? "").split(/\s+/).filter((c: string) => c && !/\d{3,}/.test(c));
  if (classes.length) {
    // prefer a class that is on exactly this element type once
    for (const c of classes) {
      const sel = `${tag}.${esc(c)}`;
      if ($(sel).length === 1) return sel;
    }
    return `${tag}.${esc(classes[0])}`;
  }
  return tag;
}
