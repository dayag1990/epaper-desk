# Bundled fonts

Both are licensed under the **SIL Open Font License 1.1** (the full text is next to each font in `OFL.txt`).
They may be used, embedded, bundled and redistributed, including in a commercial product, as long as the licence text travels with them and the fonts are not sold on their own. The files here are the **unmodified** upstream variable fonts; do not rename them if you modify them.

| Font | Use | Files | Source |
|---|---|---|---|
| Noto Serif Tamil (wdth, wght axes) | body text | `noto-serif-tamil/` | https://github.com/google/fonts/tree/main/ofl/notoseriftamil |
| Anek Tamil (wdth, wght axes, Ek Type) | headlines, display | `anek-tamil/` | https://github.com/google/fonts/tree/main/ofl/anektamil |

Fetched 2026-11-23 from the `google/fonts` repository (`ofl/` directory, which carries only OFL fonts).

Why they are in the repo: the editor runs in the reader's or editor's own browser, which may not have Tamil fonts installed, so the app serves these files as web fonts. The server (PDF, e-paper) and the editor must use the SAME files so lines break identically.
