/**
 * TEST-ONLY. Port of the prototype's parseCXML() (epaper-desk-prototype.html) used for the round-trip test.
 * The real parser belongs to packages/connectors (M1), which is not on main yet; do NOT import this from src/.
 * It runs inside Chromium because it needs a DOMParser; the function body is the prototype's, unchanged apart from
 * the helpers (kids/clean/kindOf) being inlined and rootAttrs returned instead of set globally.
 */
import type { Page } from "playwright";
import type { CxmlModel } from "../../src/index.js";

/* eslint-disable */
function parseCXMLInBrowser(text: string): any {
  const kids = (el: any, name: string) => [...el.children].filter((c: any) => c.localName === name);
  const clean = (t: string) => t.replace(/\s+/g, " ").trim();
  const kindOf = (t: string) => /^advert/i.test(t) ? "ad" : /sidebar/i.test(t) ? "side" : /^feature/i.test(t) ? "feature" : /^editorial/i.test(t) ? "edit" : "story";
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("XML is not well-formed");
  const root: any = doc.documentElement;
  if (root.localName !== "content") throw new Error("Not a ContentXML file (root is <" + root.nodeName + ">)");
  const rootAttrs = [...root.attributes].map((a: any) => ` ${a.name}="${esc(a.value)}"`).join("");
  const secs = kids(root, "section");
  if (!secs.length) throw new Error("No <section> found");
  const sections = secs.map((sec: any) => {
    const stories: any[] = []; let pend: any = null;
    for (const ctx of kids(sec, "context")) {
      const type = ctx.getAttribute("type") || "";
      const ps = kids(ctx, "p"), direct = kids(ctx, "image");
      if (!ps.length) { stories.push({type, kind:"ad", paras:[], img: direct[0] ? {ctx:"", ref: direct[0].getAttribute("ref") || ""} : null}); continue; }
      let img: any = direct[0] ? {ctx:"", ref: direct[0].getAttribute("ref") || ""} : null;
      const paras = ps.map((p: any) => {
        let t = "";
        for (const n of p.childNodes) {
          if (n.nodeType === 3 || n.nodeType === 4) t += n.nodeValue;
          else if (n.nodeType === 1) {
            if (n.localName === "context" || n.localName === "image") {
              const im = n.localName === "image" ? n : n.getElementsByTagNameNS("*", "image")[0];
              if (im && !img) img = {ctx: n.localName === "context" ? (n.getAttribute("type") || "") : "", ref: im.getAttribute("ref") || ""};
            } else t += n.textContent;
          }
        }
        return {ptype: p.getAttribute("type") || "", text: clean(t)};
      });
      if (paras.length === 1 && /quote/i.test(type)) { pend = {type, ptype: paras[0].ptype, text: paras[0].text}; continue; }
      stories.push({type, kind: kindOf(type), paras, img, kicker: pend}); pend = null;
    }
    if (pend) stories.push({type: pend.type, kind:"story", paras:[{ptype: pend.ptype, text: pend.text}], img:null});
    return {id: sec.getAttribute("id") || "", type: sec.getAttribute("type") || "", stories};
  });
  return { rootAttrs, sections };
}
/* eslint-enable */

export async function parseCxml(page: Page, text: string): Promise<CxmlModel> {
  return page.evaluate(parseCXMLInBrowser, text);
}
