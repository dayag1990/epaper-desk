import crypto from "node:crypto";

// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) on node:crypto only.
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = ALPHA.indexOf(c);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function newSecret(): string { return base32Encode(crypto.randomBytes(20)); }

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function totpAt(secretB32: string, nowMs: number, step = 30): string {
  return hotp(base32Decode(secretB32), Math.floor(nowMs / 1000 / step));
}

/** Returns the matched time step (so one code cannot be used twice) or null. Allows one step of clock drift. */
export function verifyTotp(secretB32: string, code: string, nowMs: number, step = 30): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const c = Math.floor(nowMs / 1000 / step);
  for (const d of [0, -1, 1]) {
    const a = Buffer.from(hotp(secret, c + d)), b = Buffer.from(code);
    if (crypto.timingSafeEqual(a, b)) return c + d;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "E-Paper Desk Ops"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
