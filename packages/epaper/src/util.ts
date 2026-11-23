import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const pexec = promisify(execFile);

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export async function run(cmd: string, args: string[], binary = false): Promise<Buffer | string> {
  const { stdout } = await pexec(cmd, args, { maxBuffer: 1024 * 1024 * 1024, encoding: (binary ? "buffer" : "utf8") as BufferEncoding });
  return stdout as Buffer | string;
}

/** Write atomically, only when the content differs. Returns true if the file changed. */
export async function writeIfChanged(path: string, data: Buffer | string, written?: string[]): Promise<boolean> {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  try {
    if ((await readFile(path)).equals(buf)) return false;
  } catch { /* missing */ }
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, path);
  written?.push(path);
  return true;
}

/** Run tasks with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;
