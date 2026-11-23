import { serveAdmin } from "../lib/admin-static.js";
import { adminArticleRoutes } from "./admin-articles.js";
import { adminAuditRoutes } from "./admin-audit.js";
import { adminEditionRoutes } from "./admin-editions.js";
import { adminKeyHookRoutes } from "./admin-keys-hooks.js";
import { adminMemberRoutes } from "./admin-members.js";
import { adminSettingsRoutes } from "./admin-settings.js";
import { adminSourceRoutes } from "./admin-sources.js";
import type { App } from "./types.js";

/** Everything M12 adds to the API, in one place: the admin routes and the built console under /admin. */
export function adminRoutes(app: App) {
  adminSettingsRoutes(app);
  adminMemberRoutes(app);
  adminKeyHookRoutes(app);
  adminSourceRoutes(app);
  adminArticleRoutes(app);
  adminEditionRoutes(app);
  adminAuditRoutes(app);
  const send = async (req: any, reply: any) => {
    const f = await serveAdmin(req.url);
    return reply.status(f.status).header("content-type", f.type).header("cache-control", f.cache).send(f.body);
  };
  app.get("/admin", { schema: { hide: true } }, send);
  app.get("/admin/*", { schema: { hide: true } }, send);
}
