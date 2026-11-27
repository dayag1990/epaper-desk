/**
 * The E-Paper Desk palette. One source for the TypeScript side; theme.css repeats the same values as CSS custom
 * properties and a test keeps the two identical.
 *
 * Use rules (details and the contrast table are in docs/theme.md):
 *  - press black: type and the logo.            - newsprint cream: backgrounds.
 *  - proof red: SPARINGLY. One primary action per screen, the active tab marker, error and alert state. Never body text.
 *  - plate blue: links and secondary panels.     - ink grey: secondary text.
 *  - brass: small decoration only (rules, a dot). Never the only carrier of a meaning, never text on cream.
 */
export const palette = {
  press: "#111111",
  cream: "#F4EFE6",
  proof: "#E63B2E",
  plate: "#1F4FFF",
  grey: "#5C5C5C",
  brass: "#B08D3C",
} as const;

/** Tints of the six (surfaces and hairlines), plus the one functional colour the palette does not have: status green. */
export const tints = {
  /** a card sitting on cream */
  paper: "#FBF8F2",
  /** hover and zebra rows on cream */
  cream2: "#EBE4D6",
  /** the desk behind a newspaper page in the editor */
  stage: "#CFC7B6",
  /** hairlines on cream */
  line: "#CBC2AE",
  /** status "working" light only. Always paired with the word, never alone. */
  ok: "#1B6E3A",
} as const;

export type TokenName = keyof typeof palette | keyof typeof tints;
export const allTokens: Record<TokenName, string> = { ...palette, ...tints };

/** WCAG 2.x relative luminance of #RRGGBB. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

export type UseKind = "text" | "large" | "ui";
/** WCAG AA: 4.5 for text, 3 for large text (>= 24 px, or >= 18.66 px bold) and for UI parts and graphics. */
export const AA: Record<UseKind, number> = { text: 4.5, large: 3, ui: 3 };

export interface Pair { use: string; fg: TokenName; bg: TokenName; kind: UseKind }
/** Every text/background pair the app chrome uses. A test checks each one against AA. */
export const pairs: Pair[] = [
  { use: "Body text", fg: "press", bg: "cream", kind: "text" },
  { use: "Body text on a card", fg: "press", bg: "paper", kind: "text" },
  { use: "Body text on hover/zebra rows", fg: "press", bg: "cream2", kind: "text" },
  { use: "Secondary text", fg: "grey", bg: "cream", kind: "text" },
  { use: "Secondary text on a card", fg: "grey", bg: "paper", kind: "text" },
  { use: "Secondary text on hover/zebra rows", fg: "grey", bg: "cream2", kind: "text" },
  { use: "Links", fg: "plate", bg: "cream", kind: "text" },
  { use: "Links on a card", fg: "plate", bg: "paper", kind: "text" },
  { use: "Text on a blue secondary panel", fg: "paper", bg: "plate", kind: "text" },
  { use: "Primary button label (red button)", fg: "press", bg: "proof", kind: "text" },
  { use: "Alert count in the bell", fg: "press", bg: "proof", kind: "text" },
  { use: "Text on the dark reader stage", fg: "cream", bg: "press", kind: "text" },
  { use: "Secondary text on the dark reader stage", fg: "stage", bg: "press", kind: "text" },
  { use: "Brass on the dark reader stage (small text)", fg: "brass", bg: "press", kind: "text" },
  { use: "Status word: working", fg: "ok", bg: "paper", kind: "text" },
  { use: "Red marker (active tab, alert edge) against cream", fg: "proof", bg: "cream", kind: "ui" },
  { use: "Red marker against a card", fg: "proof", bg: "paper", kind: "ui" },
  { use: "Focus ring (blue) against cream", fg: "plate", bg: "cream", kind: "ui" },
  { use: "Input and button borders (black) against cream", fg: "press", bg: "cream", kind: "ui" },
  { use: "Status dot: working", fg: "ok", bg: "paper", kind: "ui" },
];
/** Pairs that are deliberately NOT allowed (kept in the docs so nobody adds them by mistake). */
export const forbidden: Pair[] = [
  { use: "Red text on cream (fails for normal-size text)", fg: "proof", bg: "cream", kind: "text" },
  { use: "White-on-red labels (fails for normal-size text)", fg: "paper", bg: "proof", kind: "text" },
  { use: "Brass text on cream", fg: "brass", bg: "cream", kind: "text" },
  { use: "Blue text on press black", fg: "plate", bg: "press", kind: "text" },
];

export interface Row extends Pair { ratio: number; need: number; pass: boolean }
export function contrastTable(list: Pair[] = pairs): Row[] {
  return list.map((p) => {
    const ratio = contrast(allTokens[p.fg], allTokens[p.bg]);
    const need = AA[p.kind];
    return { ...p, ratio: Math.round(ratio * 100) / 100, need, pass: ratio >= need };
  });
}
