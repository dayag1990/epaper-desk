import { existsSync } from "node:fs";
import path from "node:path";
import { loadTemplateSet, type Template } from "@epaper/layout";

const root = () => process.env.TEMPLATES_DIR ?? path.resolve(process.cwd(), "../../templates");
const cache = new Map<string, Template[]>();
export function templateSets(): string[] {
  return ["broadsheet-en", "tabloid-en", "prototype-pa"].filter((s) => existsSync(path.join(root(), s)));
}
export function templateSet(name: string): Template[] | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  if (cache.has(name)) return cache.get(name)!;
  const dir = path.join(root(), name);
  if (!existsSync(dir)) return null;
  const set = loadTemplateSet(dir);
  cache.set(name, set);
  return set;
}
