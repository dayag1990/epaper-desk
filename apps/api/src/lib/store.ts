import { prisma } from "../db.js";
import { FileExistsError, fileKey, sha256, type FileDriver } from "../files/index.js";

/** Write a file once into the files store (named by hash) and record it. Same bytes twice = same row. */
export async function storeFile(driver: FileDriver, paper_id: string, kind: string, ext: string, data: Buffer, created_by: string | null = null) {
  const hash = sha256(data);
  const dup = await prisma.file.findFirst({ where: { paper_id, hash, kind, ext, deleted_at: null } });
  if (dup) return { id: dup.id, key: dup.key, hash, size: dup.size };
  const key = fileKey({ paper: paper_id, date: new Date().toISOString().slice(0, 10), kind, hash, ext });
  try {
    await driver.put(key, data);
  } catch (e) {
    if (!(e instanceof FileExistsError)) throw e;
  }
  const row = await prisma.file.upsert({
    where: { key },
    create: { paper_id, hash, kind, ext, size: data.length, key, created_by },
    update: { deleted_at: null },
  });
  return { id: row.id, key, hash, size: row.size };
}
