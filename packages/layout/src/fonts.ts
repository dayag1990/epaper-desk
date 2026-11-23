import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";

/**
 * The template fonts live in ONE place (templates/fonts). The API serves them at /fonts/<path> for the editor;
 * the headless Chromium (screen PDF, fit, snapshot) reads the very same files through a virtual origin, so both
 * contexts get the same bytes through the same @font-face CSS. Node only: the editor never imports this file.
 */
export const SERVER_FONT_ORIGIN = "http://fonts.epaper.invalid";
export const SERVER_FONT_BASE = `${SERVER_FONT_ORIGIN}/fonts`;

const FONT_TYPES: Record<string, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };
export const fontContentType = (file: string): string | null => FONT_TYPES[file.split(".").pop()!.toLowerCase()] ?? null;

/** templates/fonts: FONTS_DIR, else TEMPLATES_DIR/fonts, else the repo's templates/fonts next to this package. */
export function fontsDir(): string {
  if (process.env.FONTS_DIR) return path.resolve(process.env.FONTS_DIR);
  if (process.env.TEMPLATES_DIR) return path.resolve(process.env.TEMPLATES_DIR, "fonts");
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../templates/fonts");
}

/**
 * Absolute path of a font file under `root` for a URL-relative name, or null. Only plain font files directly inside the
 * font folder tree: no "..", no absolute paths, no NUL, no backslashes, no dotfiles, only font extensions, no symlink escape.
 */
export function resolveFontFile(root: string, rel: string): string | null {
  let name: string;
  try { name = decodeURIComponent(rel); } catch { return null; }
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/")) return null;
  const parts = name.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith("."))) return null;
  if (!fontContentType(name)) return null;
  const abs = path.resolve(root, name);
  if (!abs.startsWith(path.resolve(root) + path.sep)) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}

/** Let a Playwright page or context load the template fonts from SERVER_FONT_BASE (idempotent per target). */
const done = new WeakSet<object>();
export async function installFonts(target: Page | BrowserContext, root = fontsDir()): Promise<void> {
  if (done.has(target)) return;
  done.add(target);
  await target.route(`${SERVER_FONT_BASE}/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/fonts\//, "");
    const file = resolveFontFile(root, rel);
    if (!file) return route.fulfill({ status: 404, body: "no such font" });
    await route.fulfill({ status: 200, body: readFileSync(file), headers: { "content-type": fontContentType(file)!, "access-control-allow-origin": "*", "cache-control": "max-age=31536000, immutable" } });
  });
}
