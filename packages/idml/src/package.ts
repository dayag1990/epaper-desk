import JSZip from "jszip";
import type { LayoutSnapshot } from "@epaper/core";
import { exportIdml, type IdmlOptions, type IdmlResult } from "./export.js";

/** A picture the IDML links to: bytes from the files store, with its pixel size. */
export interface PackedAsset {
  asset_id: string;
  ext: string; // "jpg" | "png" | ...
  bytes: Uint8Array;
  w_px?: number;
  h_px?: number;
}
export interface PackedEdition {
  /** The delivery zip: `<name>.idml` + `Links/<file>` for every picture. Same input, same bytes. */
  zip: Uint8Array;
  idml: IdmlResult;
  idmlName: string;
  /** Link file names that were packed into Links/. */
  linked: string[];
  /** Pictures a frame wants that were not in `assets` (the frame is still exported, InDesign shows a missing link). */
  missing: string[];
}

/** File name a picture gets inside Links/: its asset id and extension, never the website's file name. */
export const linkName = (asset_id: string, ext: string) => `${asset_id.replace(/[^A-Za-z0-9._-]+/g, "-")}.${ext.replace(/^\./, "").toLowerCase()}`;

const FIXED_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

/**
 * Snapshot + the pictures -> the delivery zip for InDesign. Frames are re-pointed at Links/<asset id>.<ext>;
 * the style names, fonts and composer come from `opts` (see exportIdml). Pure: no clock, no I/O.
 */
export async function packEditionIdml(snapshot: LayoutSnapshot, assets: readonly PackedAsset[], name: string, opts: IdmlOptions = {}): Promise<PackedEdition> {
  const byId = new Map(assets.map((a) => [a.asset_id, a]));
  const images: NonNullable<IdmlOptions["images"]> = { ...(opts.images ?? {}) };
  const missing: string[] = [];
  const pages = snapshot.pages.map((pg) => ({
    ...pg,
    frames: pg.frames.map((f) => {
      if ((f.role !== "image" && f.role !== "ad") || !f.asset_id) return f;
      const a = byId.get(f.asset_id);
      if (!a) {
        if (f.file && !missing.includes(f.asset_id)) missing.push(f.asset_id);
        return f;
      }
      const file = linkName(a.asset_id, a.ext);
      if (a.w_px && a.h_px) images[file] = { w_px: a.w_px, h_px: a.h_px };
      return { ...f, file };
    }),
  }));
  const idml = await exportIdml({ ...snapshot, pages }, { ...opts, name, images });
  const idmlName = `${name}.idml`;
  const zip = new JSZip();
  const add = (n: string, data: Uint8Array) => zip.file(n, data, { date: FIXED_DATE, createFolders: false, unixPermissions: 0o644, compression: "DEFLATE", compressionOptions: { level: 9 } });
  add(idmlName, idml.bytes);
  const linked: string[] = [];
  for (const file of idml.links) {
    const a = assets.find((x) => linkName(x.asset_id, x.ext) === file);
    if (!a) continue;
    add(`Links/${file}`, a.bytes);
    linked.push(file);
  }
  return { zip: await zip.generateAsync({ type: "uint8array", platform: "UNIX", streamFiles: false }), idml, idmlName, linked, missing };
}
