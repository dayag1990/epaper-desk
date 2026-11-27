import fs from "node:fs";

/** For the server side of the ops desk: the theme CSS and the browser code, read from the package. */
const here = (rel: string) => new URL(rel, import.meta.url);
export const themeCss = (): string => fs.readFileSync(here("../theme.css"), "utf8");
/** dist/<name>.js (live, vanilla) served to the browser as /assets/theme/<name>.js. Build the package first (pnpm --filter @epaper/theme build). */
export function browserModule(name: "live" | "vanilla"): string {
  const f = here(`./${name}.js`);
  try { return fs.readFileSync(f, "utf8"); } catch { throw new Error(`The theme package is not built (${name}.js is missing). Run: pnpm --filter @epaper/theme build`); }
}
