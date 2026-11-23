import type { Template } from "./template.js";

/** The edition date as the template prints it in the strip, or undefined when the template has no date_format (the caller then uses its own). Pure: no clock. */
export function formatEditionDate(d: Date, t: Pick<Template, "date_format">): string | undefined {
  const f = t.date_format;
  if (!f) return undefined;
  const parts = new Intl.DateTimeFormat(`${f.locale}-u-nu-latn`, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return f.pattern.replace("{day}", get("day")).replace("{month}", get("month")).replace("{year}", get("year"));
}
