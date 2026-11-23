export const USER_AGENT = "EPaperDesk/0.1";

export type FetchErrorCode =
  | "bad_url" | "robots_blocked" | "robots_unavailable" | "timeout" | "not_found"
  | "forbidden" | "server_error" | "too_big" | "network" | "wrong_type" | "http_error";

/** An error whose message a newsroom owner can read. */
export class FetchError extends Error {
  constructor(public readonly code: FetchErrorCode, message: string, public readonly url?: string) {
    super(message);
    this.name = "FetchError";
  }
}

export interface FetchResult {
  url: string; // final URL after redirects
  status: number;
  contentType: string;
  text: string;
}

export interface Fetcher {
  get(url: string, opts?: { accept?: string; skipRobots?: boolean }): Promise<FetchResult>;
}

export interface PoliteFetcherOptions {
  userAgent?: string;
  timeoutMs?: number;
  /** minimum gap between two requests to the same host */
  minIntervalMs?: number;
  maxBytes?: number;
  respectRobots?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

// ---- robots.txt (RFC 9309 subset: groups, Allow/Disallow, * and $, Crawl-delay) ----

interface Rule { allow: boolean; pattern: string }
export interface RobotsRules { rules: Rule[]; crawlDelay?: number; sitemaps: string[]; allowAll?: boolean; denyAll?: boolean }

export function parseRobots(text: string, agent = "EPaperDesk"): RobotsRules {
  const groups: { agents: string[]; rules: Rule[]; delay?: number }[] = [];
  const sitemaps: string[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(val);
    else if (!cur) continue;
    else if (key === "allow") cur.rules.push({ allow: true, pattern: val });
    else if (key === "disallow") cur.rules.push({ allow: false, pattern: val });
    else if (key === "crawl-delay") cur.delay = Number(val);
  }
  const a = agent.toLowerCase();
  const pick = groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x)));
  const use = pick.length ? pick : groups.filter((g) => g.agents.includes("*"));
  const rules = use.flatMap((g) => g.rules).filter((r) => r.pattern !== "" || !r.allow);
  const delay = use.map((g) => g.delay).find((d) => d != null && Number.isFinite(d));
  return { rules: rules.filter((r) => r.pattern !== ""), crawlDelay: delay, sitemaps };
}

function patternToRegex(p: string): RegExp {
  const end = p.endsWith("$");
  const body = (end ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + body + (end ? "$" : ""));
}

export function robotsAllows(r: RobotsRules, pathAndQuery: string): boolean {
  if (r.denyAll) return false;
  let best: { len: number; allow: boolean } | null = null;
  for (const rule of r.rules) {
    if (patternToRegex(rule.pattern).test(pathAndQuery)) {
      const len = rule.pattern.length;
      if (!best || len > best.len || (len === best.len && rule.allow)) best = { len, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

export class PoliteFetcher implements Fetcher {
  private readonly o: Required<Omit<PoliteFetcherOptions, "fetchImpl" | "sleep">> & { fetchImpl: typeof fetch; sleep: (ms: number) => Promise<void> };
  private robots = new Map<string, Promise<RobotsRules>>();
  private lastHit = new Map<string, number>();
  private chain = new Map<string, Promise<void>>();

  constructor(opts: PoliteFetcherOptions = {}) {
    this.o = {
      userAgent: opts.userAgent ?? USER_AGENT,
      timeoutMs: opts.timeoutMs ?? 10_000,
      minIntervalMs: opts.minIntervalMs ?? 1000,
      maxBytes: opts.maxBytes ?? 5 * 1024 * 1024,
      respectRobots: opts.respectRobots ?? true,
      fetchImpl: opts.fetchImpl ?? fetch,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  /** Sitemap lines from robots.txt, for discovery. */
  async sitemapsFor(origin: string): Promise<string[]> {
    try {
      return (await this.robotsFor(origin)).sitemaps;
    } catch {
      return [];
    }
  }

  private robotsFor(origin: string): Promise<RobotsRules> {
    let p = this.robots.get(origin);
    if (!p) {
      p = (async () => {
        let res: FetchResult;
        try {
          res = await this.raw(origin + "/robots.txt", "text/plain");
        } catch (e) {
          if (e instanceof FetchError && e.code === "not_found") return { rules: [], sitemaps: [], allowAll: true };
          throw new FetchError("robots_unavailable", `We could not read ${origin}/robots.txt, so we did not fetch from this site. Try again later.`, origin);
        }
        return parseRobots(res.text, this.o.userAgent.split("/")[0]);
      })();
      this.robots.set(origin, p);
    }
    return p;
  }

  /** Wait our turn for this host. Requests to one host go one at a time, spaced out. */
  private async pace(host: string, delayMs: number): Promise<void> {
    const prev = this.chain.get(host) ?? Promise.resolve();
    const mine = prev.then(async () => {
      const wait = (this.lastHit.get(host) ?? 0) + delayMs - Date.now();
      if (wait > 0) await this.o.sleep(wait);
      this.lastHit.set(host, Date.now());
    });
    this.chain.set(host, mine.catch(() => undefined));
    await mine;
  }

  async get(url: string, opts: { accept?: string; skipRobots?: boolean } = {}): Promise<FetchResult> {
    let u: URL;
    try {
      u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    } catch {
      throw new FetchError("bad_url", `"${url}" is not a web address we can read. It must start with http:// or https://.`, url);
    }
    let delay = this.o.minIntervalMs;
    if (this.o.respectRobots && !opts.skipRobots) {
      const rules = await this.robotsFor(u.origin);
      if (!robotsAllows(rules, u.pathname + u.search))
        throw new FetchError("robots_blocked", `${u.host} asks robots not to read ${u.pathname}, so we skipped it. Only read sites you own or have rights to.`, url);
      if (rules.crawlDelay) delay = Math.max(delay, Math.min(rules.crawlDelay, 10) * 1000);
    }
    return this.raw(url, opts.accept, delay);
  }

  private async raw(url: string, accept = "*/*", delay = this.o.minIntervalMs): Promise<FetchResult> {
    const host = new URL(url).host;
    await this.pace(host, delay);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
    try {
      const res = await this.o.fetchImpl(url, {
        headers: { "User-Agent": this.o.userAgent, Accept: accept },
        redirect: "follow",
        signal: ctl.signal,
      });
      if (res.status === 404 || res.status === 410) throw new FetchError("not_found", `${host} says there is nothing at ${new URL(url).pathname}.`, url);
      if (res.status === 401 || res.status === 403) throw new FetchError("forbidden", `${host} would not let us in (error ${res.status}). It may need a login or a key.`, url);
      if (res.status >= 500) throw new FetchError("server_error", `${host} had a problem on its side (error ${res.status}). Try again later.`, url);
      if (!res.ok) throw new FetchError("http_error", `${host} answered with error ${res.status}.`, url);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > this.o.maxBytes) throw new FetchError("too_big", `That page from ${host} is too big to read.`, url);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > this.o.maxBytes) throw new FetchError("too_big", `That page from ${host} is too big to read.`, url);
      return {
        url: res.url || url,
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        text: new TextDecoder("utf-8").decode(buf),
      };
    } catch (e) {
      if (e instanceof FetchError) throw e;
      if ((e as Error)?.name === "AbortError") throw new FetchError("timeout", `${host} took too long to answer (more than ${Math.round(this.o.timeoutMs / 1000)} seconds).`, url);
      throw new FetchError("network", `We could not reach ${host}. Check the address and that the site is up.`, url);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function plainError(e: unknown): string {
  if (e instanceof FetchError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something unexpected went wrong.";
}
