import type { PageDoc } from "@epaper/core";
import type { Template } from "./layout";

// Bundled demo templates: only a fallback for when the API sends none with the edition.
const files = import.meta.glob("../../../templates/*/*.json", { eager: true, import: "default" }) as Record<string, Template>;
export const bundledTemplates: Template[] = Object.values(files);

export function templateFor(doc: PageDoc, list: readonly Template[]): Template {
  const all = [...list, ...bundledTemplates];
  const by = (f: (t: Template) => boolean) => all.find(f);
  return (
    by((t) => t.id === doc.page.template && t.size.id === doc.page.size) ??
    by((t) => t.id === doc.page.template) ??
    by((t) => t.role === (doc.page.no === 1 ? "front" : "inner") && t.size.id === doc.page.size) ??
    all[0]!
  );
}
