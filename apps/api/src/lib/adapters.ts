import { createHtmlConnector, createRssConnector, createWordpressConnector, cxmlConnector, pushConnector, PoliteFetcher, type Adapter } from "@epaper/connectors";

export function adapterFor(kind: string): Adapter<any> | null {
  const f = new PoliteFetcher();
  switch (kind) {
    case "rss": return createRssConnector(f);
    case "wordpress": return createWordpressConnector(f);
    case "scrape": case "html": return createHtmlConnector(f);
    case "cxml": return cxmlConnector as Adapter<any>;
    case "push": return pushConnector;
    default: return null;
  }
}
