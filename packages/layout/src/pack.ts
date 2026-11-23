/**
 * Row packer, ported from prototype pageEl(): fill rows of `columns`; when the next
 * story does not fit, stretch the last story of the row so no hole is left.
 * Pure and idempotent: a packed list packs to itself.
 */
export function packSpans(input: readonly number[], columns = 8): number[] {
  const spans = [...input];
  let cur = 0;
  let prev: number | null = null;
  spans.forEach((_, n) => {
    if (cur + spans[n]! > columns && prev != null) {
      spans[prev] = spans[prev]! + (columns - cur);
      cur = 0;
    }
    cur += spans[n]!;
    prev = n;
    if (cur >= columns) cur = 0;
  });
  if (cur > 0 && prev != null) spans[prev] = spans[prev]! + (columns - cur);
  return spans;
}
