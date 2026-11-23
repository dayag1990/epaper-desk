import { z } from "zod";

// D9: how the desk knows a service.

export const HealthzSchema = z.object({ ok: z.literal(true) });

export const ReadyzSchema = z.object({
  ok: z.boolean(),
  checks: z.record(z.string()).optional(), // "ok" or a plain-words reason; SPEC-VAGUE: /healthz has no checks
});
export type Readyz = z.infer<typeof ReadyzSchema>;

/** One entry of ops/services.yml = one row on the desk. */
export const ServiceEntrySchema = z.object({
  name: z.string().min(1),
  container: z.string().optional(), // outside links and backups have none
  // SPEC-VAGUE: a URL, a command (pg_isready) or an expression (wal_age_s < 180 and ...); kept a string
  ready: z.string().min(1),
  needs: z.array(z.string()).optional(), // red here? fix those first
  fixes: z.array(z.string()), // SPEC-VAGUE: seen: restart, logs, retry_jobs, restore_to_minute, run_now, verify_now
});
export const ServiceListSchema = z.array(ServiceEntrySchema);
export type ServiceEntry = z.infer<typeof ServiceEntrySchema>;
