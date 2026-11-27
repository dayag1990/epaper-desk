/** The logo mark: a folded newspaper page with a column rule. Press black, one path, no text. */
export const LOGO_PATHS = {
  // outer page with a folded corner
  page: "M5 3h16l6 6v20H5z",
  // headline bar and three text lines
  lines: "M9 12h12M9 16h14M9 20h14M9 24h9",
} as const;

export const logoSvg = (size = 28, color = "currentColor") =>
  `<svg class="ep-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-label="E-Paper Desk" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="${LOGO_PATHS.page}"/><path d="${LOGO_PATHS.lines}"/><path d="M21 3v6h6"/></svg>`;
