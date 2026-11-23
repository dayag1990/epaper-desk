import type { MockSeed } from "./core";
import type { Template } from "../src/types";
import { LayoutEngine } from "@epaper/layout";
import { ingestTamil, planTamil, proofDocs, taTemplates } from "../../../tests/ta-type/lib/tamil";

/**
 * The Tamil demo edition for the line-break proof: the 40 articles through the RSS adapter, planned onto 8 pages (one per
 * section), plus two proof pages (9: the 8 section headlines, 10: the 8 representative paragraphs). Every page is fitted with
 * the editor's own loop (start size, step down), so what the editor re-fits on open is what is stored.
 */
export async function buildTamilSeed(): Promise<MockSeed> {
  const eng = await LayoutEngine.launch();
  try {
    const arts = await ingestTamil();
    const plan = await planTamil(eng, arts);
    const t = taTemplates();
    const src = [...plan.pages.map((p) => ({ doc: p.doc ?? p.fit.doc, template: p.template })), ...proofDocs(arts, t)];
    const pages = [];
    for (const { doc, template } of src) {
      const fit = await eng.fit(doc, template, arts);
      pages.push({ id: `pg_ta${doc.page.no}`, no: doc.page.no, template_id: template.id, doc: fit.doc });
    }
    return { edition: { id: "ed_ta", name: "தென்பொதிகை · மாதிரி இதழ்", date: "2026-11-24" }, pages, templates: t as unknown as Template[], articles: arts };
  } finally { await eng.close(); }
}
