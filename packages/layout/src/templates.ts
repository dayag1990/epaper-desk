import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TemplateSchema, type Template } from "./template.js";

export function loadTemplate(file: string): Template {
  return TemplateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
/** Load every *.json in a template-set folder (e.g. templates/broadsheet-en), sorted by id for determinism. */
export function loadTemplateSet(dir: string): Template[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => loadTemplate(join(dir, f)));
}
