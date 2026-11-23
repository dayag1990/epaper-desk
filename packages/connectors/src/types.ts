import type { Article, Connector, Mapping, RawItem } from "@epaper/core";

/** Who owns the article. Passed in by the caller; connectors never invent these. */
export interface IngestContext {
  paperId: string;
  sourceId: string;
  /** Used when a source gives no date. Defaults to the time of the call. */
  now?: () => Date;
  /** Lookup tables for map(name) steps in a mapping, e.g. section names. */
  maps?: Record<string, Record<string, string>>;
}

/** An article before we add our own id, hash and rev. */
export type ArticleDraft = Omit<Article, "id" | "paper_id" | "source_id" | "content_hash" | "rev"> & {
  /** Optional ref ids for images we have already given an asset id. */
};

/** Every adapter is a core Connector plus a normalize step. */
export interface Adapter<C> extends Connector<C> {
  /** Turn a RawItem into a draft. Return null to skip on purpose (e.g. an advert). Throw Error with a plain message to reject. */
  normalize(raw: RawItem, mapping: Mapping | undefined, ctx: IngestContext): ArticleDraft | null;
  /** The mapping used when the source row has none. */
  defaultMapping?: Mapping;
}

export class RejectError extends Error {
  constructor(message: string, public readonly reasons: string[] = [message]) {
    super(message);
    this.name = "RejectError";
  }
}
