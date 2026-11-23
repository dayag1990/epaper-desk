import type { Article, LayoutSnapshot, Zone, ZoneSet } from "@epaper/core";

export type { Zone, ZoneSet };

/** One word/line box from the PDF text layer, in PDF points, origin top-left. */
export interface TextLine {
  x0: number; y0: number; x1: number; y1: number;
  text: string;
}
export interface TextPage {
  page: number;
  w: number; h: number; // points
  lines: TextLine[];
}

/** OCR is out of scope (cut order item 4): only the seam exists. */
export interface OcrProvider {
  recognize(imagePath: string, page: number): Promise<TextLine[]>;
}

export type ArticleRef = Pick<Article, "id" | "headline" | "url">;

export interface Miss { page: number; title: string; reason: string; rect?: [number, number, number, number] }

export interface BuildOptions {
  /** Root folder; output goes to <outDir>/<sha256 of the pdf>/ */
  outDir: string;
  /** The day's articles, for headline matching. */
  articles?: ArticleRef[];
  /** D4 snapshot. Pages found in it are zoned from its frames (source "snapshot"). */
  snapshot?: LayoutSnapshot;
  /** Optional snapshot item id -> article id, else the head frame text is matched. */
  itemArticles?: Record<string, string>;
  /** Image widths in px, default [400, 1600, 3200]. */
  widths?: number[];
  format?: "webp" | "jpeg";
  /** Pages processed in parallel, capped at 4. */
  concurrency?: number;
  /** Zone set version (D5). Default 1. */
  version?: number;
  /** Minimum headline similarity, default 0.6. */
  minScore?: number;
  /** Used only when the text layer is unreadable. Not implemented here. */
  ocr?: OcrProvider;
}

export interface PageResult {
  page: number;
  dir: string;
  files: Record<string, string>; // name -> sha256
  zones: ZoneSet;
  zonedBy: "snapshot" | "text" | "none";
  textReadable: boolean;
}

export interface EditionResult {
  sha256: string;
  dir: string;
  pageCount: number;
  pages: PageResult[];
  misses: Miss[];
  stats: { stories: number; zoned: number; matched: number };
  /** Files written during this call (empty on an idempotent re-run). */
  written: string[];
}
