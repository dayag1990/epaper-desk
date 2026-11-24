import fs from "node:fs";
import path from "node:path";
import type { DockerDriver } from "./docker.js";

/** Release tags look like 2026-11-21.3 */
export const RELEASE_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;
/** Default images that carry the release tag. A release is usable only when all of them exist. */
export const RELEASE_REPOS = ["epaper/api", "epaper/worker"];

export function sortReleases(tags: string[]): string[] {
  return [...tags].sort((a, b) => {
    const [da, na] = a.split("."), [db, nb] = b.split(".");
    return da === db ? Number(nb) - Number(na) : da! < db! ? 1 : -1;
  });
}

export class Releases {
  private ptr: string;
  private dbPtr: string;
  constructor(stateDir: string, private docker: DockerDriver, private keep = 5, private repos: string[] = RELEASE_REPOS) { this.ptr = path.join(stateDir, "current"); this.dbPtr = path.join(stateDir, "pgdata-source"); }
  /**
   * Where the live database folder is, after a restore-and-switch (an absolute folder). Null = the original named volume.
   * Every `compose up` must carry it, or compose would put the database back on the old volume.
   */
  dbSource(): string | null {
    try { const t = fs.readFileSync(this.dbPtr, "utf8").trim(); return t.startsWith("/") ? t : null; } catch { return null; }
  }
  /** The `current` pointer file: which release compose runs. Empty = the `dev` build. */
  current(): string | null {
    try { const t = fs.readFileSync(this.ptr, "utf8").trim(); return RELEASE_RE.test(t) ? t : null; } catch { return null; }
  }
  setCurrent(tag: string): void {
    fs.mkdirSync(path.dirname(this.ptr), { recursive: true, mode: 0o700 });
    const tmp = `${this.ptr}.tmp`;
    fs.writeFileSync(tmp, tag + "\n");
    fs.renameSync(tmp, this.ptr);
  }
  /** Newest first, at most `keep`, only tags that exist for every release image. */
  async list(): Promise<string[]> {
    const tags = await this.docker.imageTags();
    const per = this.repos.map((repo) => new Set(tags.filter((t) => t.startsWith(repo + ":")).map((t) => t.slice(repo.length + 1)).filter((t) => RELEASE_RE.test(t))));
    const all = [...per[0]!].filter((t) => per.every((s) => s.has(t)));
    return sortReleases(all).slice(0, this.keep);
  }
}
