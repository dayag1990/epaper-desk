import { z } from "zod";
import { randomBytes } from "node:crypto";

export const ID_PREFIXES = ["pap", "src", "art", "ast", "ed", "it", "z"] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Make a new id such as art_01JD... : time-sortable prefix plus random tail. */
export function newId<P extends IdPrefix>(prefix: P): `${P}_${string}` {
  let t = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(10);
  let tail = "";
  for (const b of rnd) tail += ALPHABET[b % 32];
  return `${prefix}_${time}${tail}`;
}

function idSchema<P extends IdPrefix>(prefix: P) {
  const re = new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]*$`);
  return z
    .string()
    .refine((s) => re.test(s), { message: `must be an id that starts with "${prefix}_"` })
    .transform((s) => s as `${P}_${string}`);
}

export const PaperId = idSchema("pap");
export const SourceId = idSchema("src");
export const ArticleId = idSchema("art");
export const AssetId = idSchema("ast");
export const EditionId = idSchema("ed");
export const ItemId = idSchema("it");
export const ZoneId = idSchema("z");

export type PaperIdT = z.infer<typeof PaperId>;
export type ArticleIdT = z.infer<typeof ArticleId>;
export type AssetIdT = z.infer<typeof AssetId>;
export type EditionIdT = z.infer<typeof EditionId>;
export type ItemIdT = z.infer<typeof ItemId>;
export type ZoneIdT = z.infer<typeof ZoneId>;
export type SourceIdT = z.infer<typeof SourceId>;
