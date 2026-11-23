/** XML helpers: NFC + escaping, so Gurmukhi/Telugu survive and nothing is ever malformed. */

// XML 1.0 allows #x9 #xA #xD #x20-#xD7FF #xE000-#xFFFD #x10000-#x10FFFF.
// eslint-disable-next-line no-control-regex
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const nfc = (s: string): string => s.normalize("NFC");
export const clean = (s: string): string => nfc(s).replace(INVALID, "");

export function esc(s: string): string {
  return clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Make an id that is safe as an IDML Self value. */
export const safeId = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, (c) => "_" + c.codePointAt(0)!.toString(16));

export const num = (n: number): string => String(Math.round(n * 10000) / 10000);

export type Attrs = Record<string, string | number | boolean | undefined>;
export function el(name: string, attrs: Attrs = {}, children: string | string[] = ""): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(typeof v === "number" ? num(v) : String(v))}"`)
    .join("");
  const body = Array.isArray(children) ? children.join("") : children;
  return body === "" ? `<${name}${a}/>` : `<${name}${a}>${body}</${name}>`;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const IDPKG_NS = "http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging";
export const DOM_VERSION = "14.0";
export const MM_TO_PT = 72 / 25.4;
export const mmToPt = (mm: number): number => mm * MM_TO_PT;
