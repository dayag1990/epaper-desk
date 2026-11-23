/** Tiny, safe expression evaluator for ops/services.yml and ops/alerts.yml: `a < 5 and b >= 2 or c == 0`. No eval. */
export class MissingMetric extends Error { constructor(public metric: string) { super(`no value for ${metric}`); } }
export type Metrics = Record<string, number | undefined>;

const CMP = /^\s*([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)\s*(<=|>=|==|!=|<|>)\s*([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)\s*$/;

function val(tok: string, m: Metrics): number {
  if (/^-?\d/.test(tok)) return Number(tok);
  const v = m[tok];
  if (v === undefined || Number.isNaN(v)) throw new MissingMetric(tok);
  return v;
}

export function evalExpr(expr: string, m: Metrics): boolean {
  return expr.split(/\s+or\s+/).some((orPart) =>
    orPart.split(/\s+and\s+/).every((p) => {
      const g = CMP.exec(p);
      if (!g) throw new Error(`cannot read the rule "${p.trim()}"`);
      const a = val(g[1]!, m), b = val(g[3]!, m);
      switch (g[2]) {
        case "<": return a < b;
        case "<=": return a <= b;
        case ">": return a > b;
        case ">=": return a >= b;
        case "==": return a === b;
        default: return a !== b;
      }
    }));
}

export function isExpr(s: string): boolean { return CMP.test(s.split(/\s+(?:and|or)\s+/)[0] ?? ""); }
