import { createHash } from "node:crypto";
import { mkdir, open, readFile, access, constants } from "node:fs/promises";
import path from "node:path";

export class FileExistsError extends Error {
  constructor(public key: string) {
    super("A file with this name already exists and files are never overwritten.");
  }
}
export class BadFileKeyError extends Error {}

export interface FileDriver {
  /** Write once. Throws FileExistsError if the key is taken. */
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Readiness probe: can we write here? */
  check(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KIND = /^[a-z][a-z0-9_-]{0,31}$/;
const EXT = /^[a-z0-9]{1,10}$/;
const HASH = /^[0-9a-f]{64}$/;

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** {paper}/{yyyy-mm-dd}/{kind}/{hash}.{ext} */
export function fileKey(p: { paper: string; date: string; kind: string; hash: string; ext: string }): string {
  if (!UUID.test(p.paper) || !DATE.test(p.date) || !KIND.test(p.kind) || !HASH.test(p.hash) || !EXT.test(p.ext))
    throw new BadFileKeyError("The file name parts are not valid.");
  return `${p.paper}/${p.date}/${p.kind}/${p.hash}.${p.ext}`;
}
const KEY = /^[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/[a-z][a-z0-9_-]{0,31}\/[0-9a-f]{64}\.[a-z0-9]{1,10}$/;
export const paperOfKey = (key: string) => key.split("/")[0]!;

export class FsDriver implements FileDriver {
  constructor(private root: string) {}
  private abs(key: string) {
    if (!KEY.test(key)) throw new BadFileKeyError("Not a valid file key.");
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const p = this.abs(key);
    await mkdir(path.dirname(p), { recursive: true });
    let fh;
    try {
      fh = await open(p, "wx", 0o640); // wx: fail if exists = write once
    } catch (e: any) {
      if (e.code === "EEXIST") throw new FileExistsError(key);
      throw e;
    }
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
  }
  get(key: string) {
    return readFile(this.abs(key));
  }
  async exists(key: string) {
    try {
      await access(this.abs(key), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
  async check() {
    await access(this.root, constants.R_OK | constants.W_OK);
  }
}

/** Interface stub: the s3 driver is built later (signed URLs live here too). */
export class S3Driver implements FileDriver {
  private nope(): never {
    throw new Error("The s3 file driver is not built yet. Use FILES_DRIVER=fs.");
  }
  async put(): Promise<void> { return this.nope(); }
  async get(): Promise<Buffer> { return this.nope(); }
  async exists(): Promise<boolean> { return this.nope(); }
  async check(): Promise<void> { return this.nope(); }
}

export function makeDriver(driver: string, root: string): FileDriver {
  return driver === "s3" ? new S3Driver() : new FsDriver(root);
}
