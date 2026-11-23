import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JsonFile } from "./store.js";
import { newSecret, otpauthUri, verifyTotp } from "./totp.js";

const MAX_WRONG = 5;
const LOCK_MS = 15 * 60_000;
const SESSION_MS = 12 * 3600_000;

interface UserRec {
  name: string;
  passHash: string;
  totpSecret: string;
  active: boolean; // false until the first TOTP code is confirmed at enrolment
  backupHashes: string[]; // sha256 of each unused backup code; a used one is removed
  failed: number;
  lockedUntil: number;
  lastStep: number; // newest TOTP step accepted: a code cannot be used twice
}
interface UsersFile { user?: UserRec }
interface SessionsFile { secret: string; sessions: Record<string, number> }

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: "wrong" | "locked" | "no_account"; message: string; retryAfterS?: number };

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}
function checkPassword(pw: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const h = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(hashHex, "hex");
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const normCode = (c: string) => c.replace(/[\s-]/g, "").toLowerCase();

export class Auth {
  private users: JsonFile<UsersFile>;
  private sess: JsonFile<SessionsFile>;
  constructor(stateDir: string, private now: () => number = Date.now) {
    this.users = new JsonFile(path.join(stateDir, "users.json"), () => ({}));
    this.sess = new JsonFile(path.join(stateDir, "sessions.json"), () => ({ secret: crypto.randomBytes(32).toString("hex"), sessions: {} }));
    const s = this.sess.read();
    if (!s.secret) this.sess.write({ secret: crypto.randomBytes(32).toString("hex"), sessions: {} });
    else if (!fs.existsSync(path.join(stateDir, "sessions.json"))) this.sess.write(s);
  }

  hasAccount(): boolean { return !!this.users.read().user?.active; }

  /** Step 1 of enrolment. Returns the TOTP secret and the backup codes: this is the ONLY time they are shown. */
  beginSetup(password: string): { secret: string; otpauth: string; backupCodes: string[] } {
    if (this.hasAccount()) throw new Error("An account already exists.");
    if (password.length < 12) throw new Error("The password must have at least 12 characters.");
    const secret = newSecret();
    const codes = Array.from({ length: 8 }, () => {
      const h = crypto.randomBytes(6).toString("hex");
      return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
    });
    this.users.write({
      user: { name: "owner", passHash: hashPassword(password), totpSecret: secret, active: false, backupHashes: codes.map((c) => sha(normCode(c))), failed: 0, lockedUntil: 0, lastStep: 0 },
    });
    return { secret, otpauth: otpauthUri(secret, "owner"), backupCodes: codes };
  }

  /** Step 2: the owner types one code from the authenticator, proving it is set up. */
  confirmSetup(code: string): boolean {
    const u = this.users.read().user;
    if (!u || u.active) return false;
    const step = verifyTotp(u.totpSecret, code.trim(), this.now());
    if (step === null) return false;
    this.users.write({ user: { ...u, active: true, lastStep: step } });
    return true;
  }

  login(password: string, code: string): LoginResult {
    const f = this.users.read();
    const u = f.user;
    if (!u || !u.active) return { ok: false, reason: "no_account", message: "No login has been set up yet. Open the setup page first." };
    const t = this.now();
    if (u.lockedUntil > t) {
      const s = Math.ceil((u.lockedUntil - t) / 1000);
      return { ok: false, reason: "locked", retryAfterS: s, message: `Too many wrong tries. The login is locked for ${Math.ceil(s / 60)} more minutes. Wait, then try again.` };
    }
    let good = checkPassword(password, u.passHash);
    let step: number | null = null;
    let usedBackup: string | null = null;
    const c = code.trim();
    if (good) {
      step = verifyTotp(u.totpSecret, c, t);
      if (step !== null && step <= u.lastStep) step = null; // same code twice: refused
      if (step === null) {
        const h = sha(normCode(c));
        if (u.backupHashes.includes(h)) usedBackup = h;
      }
      good = step !== null || usedBackup !== null;
    } else {
      verifyTotp(u.totpSecret, c, t); // keep timing alike
    }
    if (!good) {
      const failed = u.failed + 1;
      const lock = failed >= MAX_WRONG;
      this.users.write({ user: { ...u, failed: lock ? 0 : failed, lockedUntil: lock ? t + LOCK_MS : 0 } });
      return lock
        ? { ok: false, reason: "locked", retryAfterS: LOCK_MS / 1000, message: "Too many wrong tries. The login is locked for 15 minutes. Wait, then try again." }
        : { ok: false, reason: "wrong", message: `The password or the 6-digit code is wrong. ${MAX_WRONG - failed} tries left.` };
    }
    this.users.write({
      user: { ...u, failed: 0, lockedUntil: 0, lastStep: step ?? u.lastStep, backupHashes: usedBackup ? u.backupHashes.filter((h) => h !== usedBackup) : u.backupHashes },
    });
    return { ok: true, token: this.newSession(usedBackup !== null) };
  }

  backupCodesLeft(): number { return this.users.read().user?.backupHashes.length ?? 0; }

  private sign(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  }
  private newSession(_viaBackup: boolean): string {
    const s = this.sess.read();
    const sid = crypto.randomBytes(18).toString("base64url");
    const exp = this.now() + SESSION_MS;
    for (const [k, v] of Object.entries(s.sessions)) if (v <= this.now()) delete s.sessions[k];
    s.sessions[sid] = exp;
    this.sess.write(s);
    return `${sid}.${this.sign(sid, s.secret)}`;
  }
  verifySession(token: string | undefined): boolean {
    if (!token) return false;
    const [sid, sig] = token.split(".");
    if (!sid || !sig) return false;
    const s = this.sess.read();
    const want = this.sign(sid, s.secret);
    const a = Buffer.from(sig), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const exp = s.sessions[sid];
    return !!exp && exp > this.now();
  }
  logout(token: string | undefined): void {
    const sid = token?.split(".")[0];
    if (!sid) return;
    this.sess.update((s) => { delete s.sessions[sid]; return s; });
  }
}

/** The one-time code that lets the owner create the very first login. From env, else generated into a file. */
export function ensureSetupCode(stateDir: string, fromEnv: string | undefined): string {
  if (fromEnv) return fromEnv;
  const f = path.join(stateDir, "setup-code");
  try { return fs.readFileSync(f, "utf8").trim(); } catch { /* make one */ }
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const c = crypto.randomBytes(6).toString("hex");
  fs.writeFileSync(f, c, { mode: 0o600 });
  return c;
}
