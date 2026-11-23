/* E-Paper reader service worker: app shell precache, runtime cache, explicit edition caching. */
const SHELL = "epaper-shell-v1";
const DATA = "epaper-data-v1";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const html = await (await fetch("./index.html", { cache: "reload" })).text();
    const urls = new Set(["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./config.json"]);
    for (const m of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) urls.add(m[1]);
    await Promise.all([...urls].map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== DATA) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isImage = (u) => /\.(webp|jpe?g|png|pdf)(\?|$)/.test(u.pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.endsWith("/sw.js")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(async () => (await caches.match("./index.html", { ignoreSearch: true })) || Response.error()));
    return;
  }
  if (isImage(url)) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") (await caches.open(DATA)).put(req, res.clone());
      return res;
    })());
    return;
  }
  // everything else (json, js, css): network first, cache fallback
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(url.origin === location.origin && !url.pathname.includes("/ed/") && !url.pathname.startsWith("/v1/") ? SHELL : DATA)).put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener("message", (e) => {
  if (e.data?.type !== "cache-edition") return;
  const src = e.source;
  e.waitUntil((async () => {
    const cache = await caches.open(DATA);
    let n = 0;
    await Promise.all(e.data.urls.map(async (u) => {
      try {
        const req = new Request(u);
        if (!(await cache.match(req))) {
          const res = await fetch(req);
          if (!(res.ok || res.type === "opaque")) return;
          await cache.put(req, res);
        }
        n++;
      } catch { /* offline or missing: skip */ }
    }));
    src?.postMessage({ type: "edition-cached", count: n });
  })());
});
