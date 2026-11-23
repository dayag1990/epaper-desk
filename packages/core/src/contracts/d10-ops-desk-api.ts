import { z } from "zod";
import { IsoTime } from "../common.js";

// D10: every button is a route. apps/ops, own port, own login.

export const ServiceStatusSchema = z.object({
  name: z.string().min(1),
  state: z.string(), // SPEC-VAGUE: only "red" shown; other states (green? amber?) unknown
  since: z.string(), // SPEC-VAGUE: example "02:04" - a clock time, not ISO 8601
  last_error: z.string().nullish(),
  fixes: z.array(z.string()),
});

export const OpsStatusSchema = z.object({
  release: z.string(),
  services: z.array(ServiceStatusSchema),
  backups: z.object({
    db_wal_age_s: z.number().min(0),
    files_age_min: z.number().min(0),
    last_drill: z.string(), // SPEC-VAGUE: example "2026-11-20 pass" - date plus result in one string
  }),
  disk: z.object({ used_pct: z.number().min(0).max(100) }),
  cert_days_left: z.number(),
});
export type OpsStatus = z.infer<typeof OpsStatusSchema>;

export const LogsQuerySchema = z.object({ tail: z.coerce.number().int().min(1).default(200) });
export const JobsRetryBodySchema = z.object({
  queue: z.string().optional(),
  ids: z.array(z.string()).optional(),
});
export const DbRestoreBodySchema = z.object({ to: IsoTime });
export const FilesRestoreBodySchema = z.object({
  scope: z.enum(["file", "edition", "all"]),
  at: IsoTime, // SPEC-VAGUE: "at" type not shown; assumed an ISO time
});

// SPEC-VAGUE: responses of the POST routes, GET /ops/log and GET /ops/build are not described.
export const OPS_ROUTES = [
  ["GET", "/ops/status"],
  ["POST", "/ops/services/:name/restart"],
  ["GET", "/ops/services/:name/logs"],
  ["POST", "/ops/jobs/retry"],
  ["POST", "/ops/queues/:name/pause"],
  ["POST", "/ops/queues/:name/resume"],
  ["POST", "/ops/releases/:tag/rollback"],
  ["POST", "/ops/backups/run"],
  ["POST", "/ops/backups/verify"],
  ["POST", "/ops/db/restore"],
  ["POST", "/ops/db/restore/:id/switch"],
  ["POST", "/ops/files/restore"],
  ["GET", "/ops/log"],
  ["GET", "/ops/build"],
] as const;
