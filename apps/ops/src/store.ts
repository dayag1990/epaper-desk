import fs from "node:fs";
import path from "node:path";

/**
 * The desk's own state is plain JSON files under the state folder (no database, no API, no Postgres).
 * Writes are atomic (write temp, rename) so a power cut never leaves half a file.
 */
export class JsonFile<T> {
  constructor(private file: string, private fallback: () => T) {}
  read(): T {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")) as T; } catch { return this.fallback(); }
  }
  write(v: T): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  update(fn: (v: T) => T): T { const v = fn(this.read()); this.write(v); return v; }
}

export interface OpsLogLine { at: string; who: string; action: string; target?: string; result: "ok" | "refused" | "failed"; note?: string }

/** Who pressed what, and when. One JSON line per press; append-only. */
export class OpsLog {
  private file: string;
  constructor(dir: string) { this.file = path.join(dir, "ops-log.jsonl"); }
  add(line: Omit<OpsLogLine, "at"> & { at?: string }): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.file, JSON.stringify({ at: new Date().toISOString(), ...line }) + "\n", { mode: 0o600 });
  }
  recent(n = 100): OpsLogLine[] {
    try {
      const lines = fs.readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
      return lines.slice(-n).reverse().map((l) => JSON.parse(l) as OpsLogLine);
    } catch { return []; }
  }
}
