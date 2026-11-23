/** Tiny multipart/form-data reader: returns the first file part. No dependency needed for one upload field. */
export function firstFilePart(body: Buffer, contentType: string): { name: string; type: string; data: Buffer } | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  const boundary = Buffer.from("--" + (m[1] ?? m[2]));
  let pos = body.indexOf(boundary);
  while (pos >= 0) {
    const start = pos + boundary.length;
    if (body.subarray(start, start + 2).toString() === "--") return null;
    const headEnd = body.indexOf("\r\n\r\n", start);
    if (headEnd < 0) return null;
    const head = body.subarray(start, headEnd).toString("utf8");
    const next = body.indexOf(boundary, headEnd + 4);
    if (next < 0) return null;
    const fn = /filename="([^"]*)"/i.exec(head);
    if (fn) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? "application/octet-stream";
      return { name: fn[1]!, type, data: body.subarray(headEnd + 4, next - 2) };
    }
    pos = next;
  }
  return null;
}
