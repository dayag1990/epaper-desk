import { existsSync } from "node:fs";
import path from "node:path";
import { loadTemplateSet, type Template } from "@epaper/layout";

const root = () => process.env.TEMPLATES_DIR ?? path.resolve(process.cwd(), "../../templates");
const cache = new Map<string, Template[]>();
export function templateSet(name: string): Template[] {
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(path.join(root(), name))) throw new Error(`There is no template set called "${name}".`);
  if (!cache.has(name)) cache.set(name, loadTemplateSet(path.join(root(), name)));
  return cache.get(name)!;
}
