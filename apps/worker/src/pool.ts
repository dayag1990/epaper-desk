import { chromium, type Browser } from "playwright";
import { LayoutEngine } from "@epaper/layout";

/** One Chromium per worker. At most MAX renders at once; each slot is its own page, so renders never share state. */
const MAX = Math.min(4, Math.max(1, Number(process.env.RENDER_CONCURRENCY ?? 4)));

class RenderPool {
  private browser?: Browser;
  private launching?: Promise<Browser>;
  private active = 0;
  private waiters: Array<() => void> = [];
  private idle: LayoutEngine[] = [];

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.launching ??= chromium.launch().then((b) => {
      b.on("disconnected", () => { this.browser = undefined; this.idle = []; });
      this.browser = b;
      this.launching = undefined;
      return b;
    });
    return this.launching;
  }
  private async acquire() {
    if (this.active >= MAX) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
  }
  private release() {
    this.active--;
    this.waiters.shift()?.();
  }
  /** Run fn with the shared browser, counted against the render limit. */
  async withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(await this.getBrowser()); } finally { this.release(); }
  }
  /** Run fn with a layout engine (one page of the shared browser). */
  async withEngine<T>(fn: (e: LayoutEngine) => Promise<T>): Promise<T> {
    await this.acquire();
    let eng: LayoutEngine | undefined;
    try {
      const b = await this.getBrowser();
      eng = this.idle.pop();
      if (!eng) {
        const ctx = await b.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
        // LayoutEngine.launch() starts a browser of its own; fromPage shares ours (and routes the template fonts).
        eng = await LayoutEngine.fromPage(b, await ctx.newPage());
      }
      const out = await fn(eng);
      this.idle.push(eng);
      return out;
    } catch (e) {
      eng = undefined; // a failed engine is not reused
      throw e;
    } finally {
      this.release();
    }
  }
  async close() { await this.browser?.close().catch(() => {}); }
}
export const pool = new RenderPool();
