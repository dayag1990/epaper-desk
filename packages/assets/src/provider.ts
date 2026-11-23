import { RuleCutoutProvider, type CutoutProvider, type CutoutResult } from "./cutout.js";

export interface ProviderConfig {
  /** Optional AI/SEG provider. Used only when `aiEnabled` is true AND a provider is supplied. OFF by default. */
  ai?: CutoutProvider;
  aiEnabled?: boolean;
  aiTimeoutMs?: number;
  log?: (msg: string, err?: unknown) => void;
}

export type CutoutStatus = "ok" | "low-confidence" | "provider-error";
export interface CutoutOutcome {
  status: CutoutStatus;
  result: CutoutResult | null;
  /** The photo itself stays usable in every status. */
  photoUsable: true;
  /** True when the caller should schedule another try (provider error). */
  retry: boolean;
  /** Plain words for the editor. */
  message: string;
}

const rule = new RuleCutoutProvider();

/** Rule provider by default; AI only when switched on and present. */
export function pickProvider(c: ProviderConfig = {}): CutoutProvider {
  return c.aiEnabled && c.ai ? c.ai : rule;
}

/**
 * Never blocks a page: an AI error or timeout falls back to the rule path silently (logged); if even
 * that fails, the editor is told, the photo stays usable and a retry is requested.
 */
export async function cutOut(image: Buffer, c: ProviderConfig = {}): Promise<CutoutOutcome> {
  const log = c.log ?? (() => {});
  const run = async (p: CutoutProvider, ms?: number): Promise<CutoutResult> =>
    ms ? Promise.race([p.cut(image), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("provider timeout")), ms).unref())]) : p.cut(image);
  let result: CutoutResult | null = null;
  const chosen = pickProvider(c);
  try {
    result = await run(chosen, chosen === rule ? undefined : c.aiTimeoutMs ?? 10000);
  } catch (e) {
    log(`cut-out provider ${chosen.name} failed`, e);
    if (chosen !== rule) {
      try { result = await rule.cut(image); } catch (e2) { log("rule cut-out failed", e2); }
    }
  }
  if (!result) {
    return { status: "provider-error", result: null, photoUsable: true, retry: true,
      message: "The cut-out service is not answering. The photo is still usable as it is; we will try the cut-out again." };
  }
  return { status: result.low ? "low-confidence" : "ok", result, photoUsable: true, retry: false, message: result.message };
}
