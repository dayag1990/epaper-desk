# Newspaper finish ("ruled style")

Print-newspaper rules and furniture for every template that opts in. One renderer (`packages/layout/src/render.ts` + `css.ts`), so the editor, the headless
fit, the screen PDF and the e-paper show the same page. A template opts in with a `finish` block; a template without it (the prototype set, any paper's own
older template) renders exactly as before. Every contract change is additive and optional: pages and editions saved before this load unchanged.

## Template knobs (`templates/*/*.json`)

```json
"finish": { "ruled": true, "hair_px": 1, "heavy_px": 4, "tint": "#e6e8ee", "dropcap_scripts": ["Latin"], "dropcap_lines": 3,
            "byline_prefix": "", "jump_to": "Continued on page {n}", "jump_from": "Continued from page {n}" }
```

- Colours come from `colors.rule` (every rule, the box border) and `colors.blue` mixed 9 % into `colors.paper` (panel and brief tint; `finish.tint` overrides).
- `slots` with `tier: 1 | 2 | 3` (plus `hs` headline scale and `ratio` photo ratio) switch the auto-plan to the uneven layout. Tier 1 is the lead.
  Other slot kinds (sidebar, feature, editorial, advert) are unchanged. `css_extra` still comes last, so a paper can override anything.
- Tamil and Punjabi have their own jump wording (`jump_to` / `jump_from`). **Both need a native reader's check** (like the Tamil copy: written by us, not reviewed).

## What each feature is

1. **Rules.** Hairline between text columns (`column-rule`) and between stories (a rule above each story and a vertical rule in the gutter between neighbours in a row); a heavy
   rule (4 px) above the lead story; a double rule under the masthead (front) / above the header band (inner pages).
   *Weight:* a hairline is 1 px of the 1520 px canvas = 0.7 pt on a 381 mm page, not 0.5 pt: Chromium never draws a border thinner than one canvas pixel. Close to a print hairline, not equal.
2. **Furniture order:** kicker above the headline, deck (sub) below it, then the byline (`By NAME`, small caps) and the dateline (`CITY, 3 Nov —`, small caps, bold) run into
   the first paragraph. The dateline is drawn by CSS from `data-dl` (not typed text), so editing the paragraph never touches it and it still prints in the PDF and the e-paper text layer. With a drop cap the dateline cannot run into the first line, so it joins the byline line.
   Fields: `text.byline`, `text.dateline` (D3, optional; they come from D1 `byline` / `dateline`, which already existed). The byline is editable in the editor when a story has one.
3. **Captions.** The caption sits directly under the photo with a hairline rule above it, caption size 12 px, credit as a smaller run in the same line, in the D4 snapshot as a `caption` frame and in the IDML as `Story-caption`.
4. **Cut-out photo with text wrap.** An item with `image.cutout` is a float inside the first text column; the body text runs round the outline. The outline is read from the PNG's alpha channel in `domReady()`
   (canvas, 40 bands, widest opaque extent per band) and set as `shape-outside: polygon(...)` on the float, with the caption as a rectangle below it. The float is 88 % of a column (at most 300 px) and overhangs the story by 10 px
   into the gutter. Same code in editor, headless render and PDF: a test proves every body line starts at the same x in the PDF and in the browser (worst difference 0.00 px).
   *Fallbacks:* a picture the page may not read (another origin without CORS headers) or a solid picture gets the float's rectangle. *Limit:* the figure and its caption must fit in one text column; on a short story they continue
   into the next column (use a taller story or fewer columns). `shape-outside: url()` was tried first and rejected: Chromium puts the image at its natural pixel size, not stretched to the figure.
   *IDML:* the photo is a Rectangle with a **bounding-box** text wrap (offset 3 / 3 / 3 / 6 pt), stacked ABOVE the text frame (InDesign wraps only frames below the object). An outline wrap needs an alpha channel or clipping
   path inside the linked file, which an IDML cannot carry: a designer can switch it to "Detect edges" in one click. Best effort.
5. **Blocks** (item field `block`: `plain` | `brief` | `quote` | `panel`; `dropcap: true`). Boxed brief: border all round. Pull quote: big quote mark, heavy rule above and below, centred; the headline is the quote and the
   sub-headline is who said it; the story text is kept but not printed. Tinted panel: the template tint behind the story. In the editor: select a block, the small **Style** card under the selection (plain / boxed brief / pull quote / tinted panel, and a
   **Drop cap** switch). A plain block and a switched-off drop cap leave no field in the page (old pages stay byte-identical). Saved with the page, so they ride along in every version and restore.
   *Drop cap:* first GRAPHEME (`Intl.Segmenter`, so a Tamil consonant with its vowel sign stays whole), 3 lines, template red. **Latin only** (`dropcap_scripts`): a Tamil or Gurmukhi aksharas is much wider than a Latin capital and Gurmukhi letters hang from a joined headline bar, so a big
   first letter breaks the line and the bar; the switch is disabled for those stories with a plain-words reason. A paper can add a script to `dropcap_scripts` after a native review.
   *In IDML:* paragraph styles `Story-byline`, `Story-jump`, `Story-pullquote`, `Story-body-dropcap` (real `DropCapLines`/`DropCapCharacters`), character style `Dateline` (small caps, bold, run into paragraph 1), object styles `Rule-hair`, `Rule-heavy`,
   `Rule-double`, `Box-brief`, `Panel-tint`; boxes and tints are Rectangles under the text, rules are GraphicLines, colours are RGB swatches taken from the template. Column rules inside one text frame do not exist in InDesign and are not exported.
   *In the e-paper:* the text is real PDF text (byline, dateline, pull quote, jump lines), so it is in the text layer; a story's tap zone includes its byline and jump line.
6. **Header band and jump lines.** Inner pages: double rule, section name left, date centre, boxed folio right. The folio number is the page's real number (a deleted or moved page never prints a stale one).
   Stories are not split today, so jump lines work on items flagged as continued: `item.jump = { role: "to" | "from", pair: <other item id>, page }` prints "Continued on page N" under the part and "Continued from page N" above the rest.
   `syncJumps()` (`@epaper/core`) sets N from the partner's real page, drops a line whose partner is gone, and runs on **every editor edit** and in **`DELETE /v1/pages/:id`** (earlier pages get a "renumber" version when their line changes; approved or locked pages are left alone).
   `continueStory()` splits a story over two pages and links the halves. *Not done:* there is no button for "run this story on to the next page" yet; the data, the render, the sync and the helper exist and are tested.
7. **Uneven layout.** Auto-plan (`autoplan.ts`, `tiers.ts`) gives each page ONE dominant lead: the most important story that has a picture, at least 60 % of the columns (or the full width), headline scale 1.3, photo ratio 2.6, never narrower than another story, and
   the biggest photo on the page. The rest step down (tier 2: scale 1.0; tier 3: 0.85; wide secondary photos are flatter). Widths come from a height estimate (exact DP over rows of one to three stories, lead width tried from full width down to 60 %) so the stories of a row are about equally tall; the real render
   then measures **holes** (empty paper under a short story in a stretched row, `FitReport.hole_pct`) and the bounded repair search counts them (more than 3 % of the sheet), also preferring readable type. A page that overflows first gets "compact" furniture (smaller headlines, flatter photos), then the old moves.
   Type never goes below the template's `min_px` (Tamil and Punjabi 12 px = 8.5 pt); stories move or go to `unplaced` instead. A story with the paper's own `layout_hint` (slot and span) keeps that layout: the CMS decides, the lead rule does not override it.

## Known limits

- Hairlines are 0.7 pt, not 0.5 pt (see 1). Drop caps are Latin only. Pull quotes print no body text.
- A tall cut-out in a short story continues into the next text column. Cut-out wrap in IDML is the bounding box.
- Auto-plan costs more renders than before (about 18 evaluations for 4 English pages, 3-4 s); the repair budget for ruled templates is 14.
- Planned pages keep holes of 1-5 % of the sheet; a row of unequal stories can show empty paper under the short one (the panel block fills it with the tint).
- Jump lines: no editor button yet. Tamil / Punjabi jump wording is unreviewed. Firefox and Safari are not tested (they compute `shape-outside` themselves).
- Server-side planning and the editor read the same templates; run `pnpm -r build` before the Tamil / planning tests in `tests/` (they import `dist`).

## Tests

`packages/core/test` (contracts, jump sync), `packages/layout/test/finish.test.ts` + `uneven.test.ts`, `packages/export/test/finish.test.ts` (PDF text, e-paper text layer, wrap in PDF = wrap in browser),
`packages/idml/test/finish.test.ts`, `packages/epaper/test/finish.test.ts`, `apps/api/test/page-delete.test.ts`, `apps/editor/tests/finish.test.ts` and `apps/editor/e2e/finish.spec.ts` (Style control, mock mode).
Pictures: `scripts/finish-shots.mts <dir> before|after` renders English, Tamil and Punjabi pages (and `-finish` variants with every block) and exports one PDF and one IDML.
