export interface QueueStats { queues: { name: string; depth: number; paused: boolean }[]; dead: number }

/**
 * The only place the desk talks to the API, and only for queue things.
 * Every call is optional: if the API is down the desk says so in plain words and carries on.
 * Contract the API must offer (internal, bearer OPS_API_TOKEN):
 *   GET  /internal/ops/queues            -> QueueStats
 *   POST /internal/ops/jobs/retry        {queue?, ids?} -> {retried:number}
 *   POST /internal/ops/queues/:name/(pause|resume)
 */
export interface ApiClient {
  queueStats(): Promise<QueueStats | null>;
  retry(body: { queue?: string; ids?: string[] }): Promise<{ retried: number }>;
  setPaused(queue: string, paused: boolean): Promise<void>;
}

export class ApiUnavailable extends Error {}

export class HttpApiClient implements ApiClient {
  constructor(private base: string, private token: string | undefined) {}
  private async req(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetch(this.base + path, {
        method,
        headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ApiUnavailable("The API is not answering, so the desk cannot do this. Restart the API first, then press this again.");
    }
  }
  async queueStats(): Promise<QueueStats | null> {
    try {
      const r = await this.req("GET", "/internal/ops/queues");
      return r.ok ? ((await r.json()) as QueueStats) : null;
    } catch { return null; }
  }
  async retry(body: { queue?: string; ids?: string[] }) {
    const r = await this.req("POST", "/internal/ops/jobs/retry", body);
    if (!r.ok) throw new ApiUnavailable(r.status === 404 ? "The API does not offer this yet (the queue controls are not installed in it)." : `The API refused (answer ${r.status}). Look at its logs.`);
    return (await r.json()) as { retried: number };
  }
  async setPaused(queue: string, paused: boolean) {
    const r = await this.req("POST", `/internal/ops/queues/${encodeURIComponent(queue)}/${paused ? "pause" : "resume"}`);
    if (!r.ok) throw new ApiUnavailable(r.status === 404 ? "The API does not offer this yet (the queue controls are not installed in it)." : `The API refused (answer ${r.status}). Look at its logs.`);
  }
}
