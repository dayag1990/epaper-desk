// A tiny in-memory stand-in for the Prisma client: only what the admin routes call.
// Where-clauses support equality, null, { not }, { in }, { contains, mode }, { lt/gt }, OR, and ignore relation filters (paper, user).
import { randomUUID } from "node:crypto";

type Row = Record<string, any>;
const REL = new Set(["paper", "user"]);

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (REL.has(k)) return true;
    if (k === "OR") return (v as Row[]).some((w) => match(row, w));
    const x = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return v.not === null ? x != null : x !== v.not;
      if ("in" in v) return v.in.includes(x);
      if ("contains" in v) return String(x ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      if ("lt" in v) return x < v.lt;
      if ("gt" in v) return x > v.gt;
      return true;
    }
    return v === undefined ? true : (x ?? null) === v;
  });
}

function table(pk: string[] | string = "id", defaults: () => Row = () => ({})) {
  const rows: Row[] = [];
  const keyOf = (w: Row) => (Array.isArray(pk) ? w : w);
  const t = {
    rows,
    async create({ data }: any) { const r = { ...(Array.isArray(pk) ? {} : { [pk]: randomUUID() }), created_at: new Date(), deleted_at: null, ...defaults(), ...data }; rows.push(r); return { ...r }; },
    async createMany({ data }: any) { for (const d of data) await t.create({ data: d }); return { count: data.length }; },
    async findMany({ where, orderBy, take }: any = {}) {
      let r = rows.filter((x) => match(x, where)).map((x) => ({ ...x }));
      const o = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (o) { const [f, d] = Object.entries(o)[0] as [string, string]; r.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (d === "desc" ? -1 : 1)); }
      return take ? r.slice(0, take) : r;
    },
    async findFirst(a: any = {}) { return (await t.findMany(a))[0] ?? null; },
    async findUnique({ where }: any) {
      const w = Object.fromEntries(Object.entries(where).flatMap(([k, v]) => (v && typeof v === "object" && !(v instanceof Date) ? Object.entries(v) : [[k, v]])));
      const r = rows.find((x) => match(x, w)); return r ? { ...r } : null;
    },
    async count({ where }: any = {}) { return rows.filter((x) => match(x, where)).length; },
    async update({ where, data }: any) {
      const w = Object.fromEntries(Object.entries(where).flatMap(([k, v]) => (v && typeof v === "object" && !(v instanceof Date) ? Object.entries(v) : [[k, v]])));
      const r = rows.find((x) => match(x, w)); if (!r) throw new Error("no row");
      Object.assign(r, data); return { ...r };
    },
    async updateMany({ where, data }: any) { const hit = rows.filter((x) => match(x, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    async deleteMany({ where }: any = {}) { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i]!, where)) rows.splice(i, 1); return {}; },
  };
  void keyOf;
  return t;
}

export function makeFake() {
  const notes: any[] = [];
  return {
    /** what was announced with pg_notify (parsed), oldest first */
    notes,
    async $executeRaw(_strings: TemplateStringsArray, ...vals: any[]) { try { notes.push(JSON.parse(vals[0])); } catch { /* not an event */ } return 1; },
    paper: table(), user: table(), membership: table([]), session: table(), apiKey: table(), source: table(),
    article: table(), edition: table(), page: table(), pageVersion: table(), export: table(), epEdition: table(),
    webhook: table(), webhookDelivery: table(), auditLog: table(), pageArticle: table([]), asset: table(),
    async $transaction(ops: any) { return Array.isArray(ops) ? Promise.all(ops) : ops({}); },
  };
}
export type Fake = ReturnType<typeof makeFake>;
