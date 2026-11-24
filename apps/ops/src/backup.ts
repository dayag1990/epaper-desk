import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface BackupSet { at: string; size_bytes: number }
export interface BackupStatus {
  files: BackupSet | null; // restic snapshot of the files folder
  wal: BackupSet | null; // newest archived database log segment
  base: BackupSet | null; // newest nightly base backup
  drill: { at: string; result: "pass" | "fail" } | null;
}
export interface OldCopy { id: string; path: string; bytes: number; age_days: number; what: string }
export interface OldCopies { items: OldCopy[]; kept: { what: string; reason: string }[]; total_bytes: number }
export interface RestoreResult { id: string; counts: { table: string; live: number; restored: number }[] }

/** A plain-words failure. The message is what the owner reads. */
export class BackupError extends Error {}

/**
 * The desk never touches the bucket itself. It only calls the backup agent's programs:
 *   backup-now.sh                        run a backup now
 *   backup-now.sh --status               print JSON: {files:{at,size_bytes},wal:{..},base:{..},drill:{at,result}}  (null for a set that does not exist)
 *   backup-now.sh --verify               run the restore drill
 *   backup-now.sh --snapshot "<reason>"  quick safety snapshot; prints {"id":"..."}
 *   backup-now.sh --old-copies          JSON {items:[{id,path,bytes,age_days,what}],kept:[{what,reason}],total_bytes}: old safety dumps / restored databases that may be freed
 *   backup-now.sh --discard-copies <id>...   delete those; prints {removed:[],refused:[]} (only ids the list holds)
 *   restore.sh db --to <ISO time>        build a second Postgres at that minute; prints {"id","counts":[{table,live,restored}]}
 *   restore.sh db-switch <id>            switch to the restored copy (old one is kept 7 days)
 *   restore.sh files --scope file|edition|all --at <ISO time>
 */
export interface BackupDriver {
  status(): Promise<BackupStatus>;
  runNow(): Promise<void>;
  verify(): Promise<void>;
  snapshot(reason: string): Promise<{ id: string }>;
  restoreDb(to: string): Promise<RestoreResult>;
  switchDb(id: string): Promise<void>;
  restoreFiles(scope: "file" | "edition" | "all", at: string): Promise<void>;
  oldCopies(): Promise<OldCopies>;
  discardCopies(ids: string[]): Promise<{ removed: string[]; refused: string[] }>;
}

type Run = (file: string, args: string[], timeoutMs: number) => Promise<string>;
const realRun: Run = (file, args, timeoutMs) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 8e6 }, (e, stdout, stderr) => {
      if (!e) return resolve(stdout);
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "EACCES")
        return reject(new BackupError(`The backup program (${path.basename(file)}) is not installed yet, so this button cannot work. Backups are NOT running. Ask for the backup scripts to be installed in ${path.dirname(file)}.`));
      const tail = String(stderr || stdout || e.message).trim().split("\n").slice(-3).join(" ").slice(0, 300);
      reject(new BackupError(`The backup program stopped with an error: ${tail || "no details"}. Nothing was changed by the desk.`));
    }));

export class ScriptBackupDriver implements BackupDriver {
  constructor(private scriptsDir: string, private run: Run = realRun) {}
  private p(n: string) { return path.join(this.scriptsDir, n); }
  private exists(n: string): boolean { try { fs.accessSync(this.p(n), fs.constants.X_OK); return true; } catch { return false; } }
  private async go(n: string, args: string[], ms = 3_600_000): Promise<string> {
    if (!this.exists(n)) throw new BackupError(`The backup program (${n}) is not installed yet, so this button cannot work. Backups are NOT running. Ask for the backup scripts to be installed in ${this.scriptsDir}.`);
    return this.run(this.p(n), args, ms);
  }
  private json<T>(s: string, what: string): T {
    try { return JSON.parse(s) as T; } catch { throw new BackupError(`The backup program gave an answer the desk cannot read (${what}). Nothing was changed.`); }
  }
  async status(): Promise<BackupStatus> {
    const r = this.json<Partial<BackupStatus>>(await this.go("backup-now.sh", ["--status"], 60_000), "status");
    return { files: r.files ?? null, wal: r.wal ?? null, base: r.base ?? null, drill: r.drill ?? null };
  }
  async runNow() { await this.go("backup-now.sh", []); }
  async verify() { await this.go("backup-now.sh", ["--verify"]); }
  async snapshot(reason: string) { return this.json<{ id: string }>(await this.go("backup-now.sh", ["--snapshot", reason], 900_000), "snapshot"); }
  async restoreDb(to: string) { return this.json<RestoreResult>(await this.go("restore.sh", ["db", "--to", to]), "restore"); }
  async oldCopies() { return this.json<OldCopies>(await this.go("backup-now.sh", ["--old-copies"], 120_000), "old copies"); }
  async discardCopies(ids: string[]) { return this.json<{ removed: string[]; refused: string[] }>(await this.go("backup-now.sh", ["--discard-copies", ...ids], 900_000), "discard"); }
  async switchDb(id: string) { await this.go("restore.sh", ["db-switch", id]); }
  async restoreFiles(scope: string, at: string) { await this.go("restore.sh", ["files", "--scope", scope, "--at", at]); }
}
