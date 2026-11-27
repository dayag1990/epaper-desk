import { readFileSync } from "node:fs";

/**
 * Style map: our paragraph style names -> the names to write into the IDML.
 * Default = our demo names, unchanged. The client's real style names are NOT known; to use them, pass a map
 * (or a JSON file via loadStyleMap) so that InDesign paragraph styles of the same name apply by name.
 * Names not in the map pass through unchanged.
 */
export interface StyleMap {
  paragraph: Record<string, string>;
}

/** Style names used when a frame carries none (by role). */
export const ROLE_DEFAULT_STYLE = {
  masthead: "Masthead",
  strip: "Strip",
  kicker: "Story-kicker",
  head: "Story-head",
  sub: "Story-sub-head",
  body: "Story-body",
  caption: "Story-caption",
  byline: "Story-byline",
  jump: "Story-jump",
} as const;

/** Paragraph styles the newspaper finish adds (mapped through the same style map as the others). */
export const FINISH_STYLE = {
  pullquote: "Story-pullquote",
  dropcapBody: "Story-body-dropcap",
} as const;

export const DEFAULT_STYLE_MAP: StyleMap = {
  paragraph: Object.fromEntries(Object.values(ROLE_DEFAULT_STYLE).map((n) => [n, n])),
};

export function parseStyleMap(json: unknown): StyleMap {
  const p = (json as { paragraph?: unknown })?.paragraph;
  if (!p || typeof p !== "object") throw new Error('Style map file must look like {"paragraph": {"Story-head": "Headline"}}.');
  for (const [k, v] of Object.entries(p)) if (typeof v !== "string" || !v) throw new Error(`Style map entry "${k}" must be a non-empty style name.`);
  return { paragraph: { ...(p as Record<string, string>) } };
}

export const loadStyleMap = (path: string): StyleMap => parseStyleMap(JSON.parse(readFileSync(path, "utf8")));
