// Spec examples with the "..." placeholders filled in.
export const article = {
  id: "art_01JD0000AAAA", paper_id: "pap_01JD0000AAAA", source_id: "src_01JD0000AAAA",
  external_id: "wp:48213", url: "https://site.com/news/slug", lang: "pa", script: "Guru",
  section: "world", tags: ["canada"], priority: 70, kicker: null,
  headline: "Headline", subhead: "Subhead", byline: "By A", dateline: "Montreal, 2 Apr",
  body: [{ t: "p", text: "a" }, { t: "h", text: "b" }, { t: "quote", text: "c" }],
  images: [{ asset_id: "ast_01JD0000AAAA", role: "lead", src: "https://site.com/img/100.jpg", caption: "c", credit: "x" }],
  layout_hint: { page: "Main", slot: "story_col_span-3-1", span: 3, order: 1 },
  published_at: "2026-04-02T10:15:00-04:00", updated_at: "2026-04-02T11:02:00-04:00",
  content_hash: "sha256:abc123", rev: 3,
};
export const wpSource = {
  kind: "wordpress",
  config: { base: "https://site.com", poll: "*/5 * * * *" },
  mapping: {
    external_id: "$.id | prefix('wp:')", url: "$.link", headline: "$.title.rendered | strip_html",
    subhead: "$.excerpt.rendered | strip_html", body: "$.content.rendered | html_to_blocks",
    section: "$._embedded['wp:term'][0][0].slug | map(sections)",
    "images[0].src": "$._embedded['wp:featuredmedia'][0].source_url",
    published_at: "$.date_gmt | parse_date('UTC')",
  },
};
export const scrapeSource = {
  kind: "scrape",
  config: { list: ["https://site.com/world/"], link_selector: "article a.title", obey_robots: true },
  mapping: {
    headline: "css:h1.entry-title", body: "css:div.entry-content p | blocks",
    "images[0].src": "css:meta[property='og:image']@content", published_at: "jsonld:datePublished",
  },
};
export const rawItem = { ref: { id: 1 }, format: "json", data: { a: 1 }, fetchedAt: "2026-04-02T10:15:00Z" };
export const pageDoc = {
  page: { no: 1, size: "broadsheet", w_mm: 381, h_mm: 578, template: "front_a", body_pt: 8.7 },
  furniture: { masthead: "M", tagline: "T", strip: ["a", "b", "c"] },
  items: [{
    id: "it_1", kind: "story", article_id: "art_01JD0000AAAA", article_rev: 3,
    slot: "story_col_span-3-1", span: 3, cols: 3, hs: 1.0,
    text: { kicker: null, head: "H", sub: "S", body: ["a", "b"] },
    image: { asset_id: "ast_01JD0000AAAA", ratio: 1.78, cutout: false, focal: [0.5, 0.4] },
    styles: { head: "Story-head", sub: "Story-sub-head", body: "Story-body" },
  }],
  status: "draft", rev: 12,
};
export const snapshot = {
  edition_id: "ed_01JD0000AAAA", unit: "mm", origin: "page top-left",
  pages: [{ no: 1, w: 381, h: 578, fill_pct: 98, frames: [
    { id: "it_1.head", item: "it_1", role: "head", x: 8.5, y: 62.1, w: 136.4, h: 21.0, style: "Story-head", font: "F", size_pt: 27.5, text: "T" },
    { id: "it_1.img", item: "it_1", role: "image", x: 8.5, y: 86.0, w: 136.4, h: 76.6, asset_id: "ast_01JD0000AAAA", file: "100.jpg", crop: [0, 0.1, 1, 0.8], wrap: "none" },
    { id: "it_1.body", item: "it_1", role: "body", x: 8.5, y: 166.0, w: 136.4, h: 96.2, cols: 3, gutter: 5.0, style: "Story-body", size_pt: 8.7, paras: ["a", "b"], overset: false },
  ] }],
};
export const zones = {
  page: 1, image: { w: 3200, h: 4855 }, version: 2,
  zones: [{ id: "z_1", article_id: "art_01JD0000AAAA", title: "T", url: "https://site.com/news/slug",
    rects: [[0.022, 0.107, 0.358, 0.330]], confidence: 0.93, source: "auto" }],
};
export const webhook = { event: "edition.published", paper: "slug", edition: "2026-11-18", pages: 16, url: "https://epaper.site.com/2026-11-18/1" };
export const webhookHeaders = { "x-epaper-signature": "sha256=abcdef01", "x-epaper-delivery": "3b241101-e2bb-4255-8caf-4136c566a962" };
export const embed = { "data-paper": "slug", "data-edition": "latest" };
export const token = { sub: "u1", plan: "gold" };
export const services = [
  { name: "worker", container: "epaper-worker", ready: "http://worker:3001/readyz", needs: ["postgres", "files"], fixes: ["restart", "logs", "retry_jobs"] },
  { name: "postgres", container: "epaper-postgres", ready: "pg_isready", fixes: ["restart", "logs", "restore_to_minute"] },
  { name: "backups", ready: "wal_age_s < 180 and files_age_min < 30", fixes: ["run_now", "verify_now"] },
  { name: "claude-api", ready: "https://api.anthropic.com", fixes: [] },
];
export const opsStatus = {
  release: "2026-11-21.3",
  services: [{ name: "worker", state: "red", since: "02:04", last_error: "cannot reach postgres:5432", fixes: ["restart", "logs", "retry_jobs"] }],
  backups: { db_wal_age_s: 41, files_age_min: 9, last_drill: "2026-11-20 pass" },
  disk: { used_pct: 63 }, cert_days_left: 71,
};
