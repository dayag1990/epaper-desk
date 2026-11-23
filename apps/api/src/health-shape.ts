import { z } from "zod";

// MOVE-TO-CORE: contract D9 (health). packages/core will own this after merge.
export const HealthResponse = z.object({ ok: z.literal(true) });
export const ReadyResponse = z.object({
  ok: z.boolean(),
  checks: z.record(z.string()),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;

/** Run named checks; each resolves to "ok" or throws. 5 s limit each. */
export async function runChecks(
  checks: Record<string, () => Promise<void>>,
  timeoutMs = 5000,
): Promise<{ status: 200 | 503; body: ReadyResponse }> {
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(checks).map(async ([name, fn]) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          fn(),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new Error(`timeout after ${timeoutMs / 1000} s`)), timeoutMs);
          }),
        ]);
        out[name] = "ok";
      } catch (e) {
        out[name] = e instanceof Error && e.message.startsWith("timeout") ? e.message : "failed";
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
  const ok = Object.values(out).every((v) => v === "ok");
  return { status: ok ? 200 : 503, body: { ok, checks: out } };
}
