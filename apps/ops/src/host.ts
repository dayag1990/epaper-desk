import fs from "node:fs";
import path from "node:path";

/** Disk and memory, read from the host's /proc (mounted read-only) and the files volume. */
export interface HostMetrics { disk_used_pct?: number; disk_free_gb?: number; mem_available_pct?: number; load1?: number }

export function readHost(procDir: string, filesDir: string): HostMetrics {
  const out: HostMetrics = {};
  try {
    const s = fs.statfsSync(filesDir);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    if (total > 0) { out.disk_used_pct = Math.round(((total - free) / total) * 1000) / 10; out.disk_free_gb = Math.round((free / 1e9) * 10) / 10; }
  } catch { /* stays undefined: shown red */ }
  try {
    const t = fs.readFileSync(path.join(procDir, "meminfo"), "utf8");
    const get = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(t)?.[1]);
    const total = get("MemTotal"), avail = get("MemAvailable");
    if (total > 0 && avail >= 0) out.mem_available_pct = Math.round((avail / total) * 1000) / 10;
  } catch { /* undefined */ }
  try { out.load1 = Number(fs.readFileSync(path.join(procDir, "loadavg"), "utf8").split(" ")[0]); } catch { /* undefined */ }
  return out;
}
