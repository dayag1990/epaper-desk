/**
 * Photo caption line. The article's picture carries a `caption` and, optionally, a `credit` (D1). Many feeds put the
 * credit INSIDE the caption string ("File photo · Photo: Jane Doe, CC BY-SA 4.0, Wikimedia Commons"); the page prints the
 * credit in a smaller run of the same line, so the two are told apart here. Pure, no DOM.
 */
export interface CaptionParts {
  /** The caption proper (may be empty). */
  text: string;
  /** The credit, printed small after the caption (may be empty). */
  credit: string;
}

/** Where a credit starts inside a caption: a "Photo:" / "படம்:" style label, optionally after a separator. */
const CREDIT_LABEL = /(?:^|[\s]*[·•|—–]\s*|\s{2,}|\s+)((?:Photo|Photograph|Image|Picture|Credit|Credits|படம்)\s*[:：]\s*\S.*)$/isu;

const tidy = (s: string): string => s.replace(/\s+/g, " ").trim().replace(/^[·•|—–:,;\s]+|[·•|—–:,;\s]+$/gu, "");

export function splitCaption(caption: string | null | undefined, credit?: string | null): CaptionParts {
  const cap = (caption ?? "").replace(/\s+/g, " ").trim();
  const cr = (credit ?? "").replace(/\s+/g, " ").trim();
  if (cr) {
    // the credit is given separately; if the caption repeats it, print it once
    const at = cap.indexOf(cr);
    const text = at >= 0 ? tidy(cap.slice(0, at) + cap.slice(at + cr.length)) : tidy(cap);
    return { text, credit: cr };
  }
  const m = CREDIT_LABEL.exec(cap);
  if (!m) return { text: tidy(cap), credit: "" };
  return { text: tidy(cap.slice(0, m.index)), credit: m[1]!.trim() };
}
