import type { ZoneSet } from "@epaper/core";

export type { ZoneSet };
export type Zone = ZoneSet["zones"][number];

/** One line box from text.json, PDF points, origin top-left. */
export interface TextLine { x0: number; y0: number; x1: number; y1: number; text: string }
export interface TextPage { page: number; w: number; h: number; lines: TextLine[] }

export interface EditionInfo { id: string; paper: string; date: string; pages: number }
export interface PageInfo {
  id: string;
  no: number;
  image: { w: number; h: number };
  /** image level width -> url */
  images: Record<number, string>;
  zonesUrl: string;
  textUrl: string | null;
  pdfUrl: string | null;
}

/** Everything the reader needs from an edition. Two implementations: HTTP API and static folder. */
export interface EditionSource {
  /** Newest edition, or the one on `date` (YYYY-MM-DD). */
  edition(date?: string): Promise<EditionInfo>;
  pages(ed: EditionInfo): Promise<PageInfo[]>;
  zones(page: PageInfo): Promise<ZoneSet>;
  text(page: PageInfo): Promise<TextPage | null>;
}

export interface ReaderConfig {
  source: "http" | "static";
  /** http: API origin/base. static: folder that holds latest.json and <sha>/ */
  apiBase?: string;
  staticBase?: string;
  paper: string;
}
