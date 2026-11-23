# Tamil typography: தென்பொதிகை demo paper

Template set `templates/broadsheet-ta/` (front_a, inner_a, inner_b), marked "demo default" (not any client's design). Fictional paper, Tamil
text by an AI model: a native reader must review the language before it is shown to readers.

## One font source, one CSS

- Fonts: `templates/fonts/noto-serif-tamil/NotoSerifTamil[wdth,wght].ttf` (body) and `templates/fonts/anek-tamil/AnekTamil[wdth,wght].ttf`
  (headlines), the unmodified OFL variable fonts. Licence texts travel with them (`OFL.txt`).
- The **editor** (a browser that may have no Tamil font) loads them from the API: `GET /fonts/<folder>/<file>` (`apps/api/src/routes/fonts.ts`).
  Read only from `templates/fonts`; only font files; no `..`, no encoded tricks, no dotfiles, no other file types; `Cache-Control: public, max-age=31536000, immutable`,
  ETag/304, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`. Tests: `apps/api/test/fonts-route.test.ts`.
- The **server** (fit, snapshot, screen PDF, so the e-paper) reads the same files through the same @font-face CSS. Playwright's `page.route` answers a
  virtual origin (`http://fonts.epaper.invalid/fonts/...`) from `templates/fonts` (`packages/layout/src/fonts.ts`, `installFonts`), which works with `setContent`.
  Chromium embeds the glyphs it uses in the PDF (`pdffonts`: "NotoSerifTamil", "AnekTamil_800wght", all `emb yes`; Skia writes variable-font instances as Type 3 fonts with a ToUnicode map, so text stays searchable).
- `paperCss(template, {fontBase})` and `renderPage(..., {fontBase})` take the font base: editor `<api base>/fonts` (the API origin), server `SERVER_FONT_BASE`. Apart from that prefix the two stylesheets are byte-identical (tested).
- Both families: `font-weight:100 900; font-stretch:75% 125%; font-display:block`. (The files' real ranges are a little narrower: Noto Serif Tamil wdth 62.5-100, Anek Tamil wght 100-800; the browser clamps.)
  `block` means text is never set in a fallback font. Axes are explicit: body `wght 400, wdth 100`, headlines `wght 800, wdth 100`, bold bits `wght 700`, in `font-weight`
  and in `font-variation-settings`. Features: `"ccmp" 1,"locl" 1,"kern" 1,"liga" 1`, `font-kerning:normal`, `text-rendering:geometricPrecision`, `font-synthesis:none`, `letter-spacing:0` (tracking breaks Tamil ligatures). `lang="ta"` on `.page`.
- **Nothing is measured before the fonts are in.** `domReady()` asks every declared face to load, then waits for `document.fonts.ready` (the ready promise alone can resolve before a lazily-fetched face has started loading); `domFill()` throws if any face is not `loaded`;
  the PDF job waits the same way. The editor measures only after `domReady()`.

## Hyphenation and line breaking

Everywhere (`paperCss`, all templates): `hyphens:none; -webkit-hyphens:none; line-break:strict; word-break:normal; overflow-wrap:normal`. A Tamil word is never split; a line can only break at a space (or after a hyphen-minus that is not between digits).
`text-wrap: pretty` is not used: it only changes the last lines and is not implemented the same in every browser, which would break the one-layout rule.

## Justified or left-aligned: measured, left-aligned chosen

Measured in real Chromium on the 8 planned pages (40 articles, no photos; `tests/ta-type/typography.test.ts`, which prints these numbers), 2,017 body lines (last line of a paragraph excluded):

| | word-space growth | lines worse than 2x normal space |
|---|---|---|
| justified | mean 7.7x, median 5.1x, p90 17x, max 50x | **85.8 %** (92.8 % worse than 1.5x) |
| left-aligned | 1.00x by definition | 0 %; ragged edge: mean 14.5 % of the column, p90 29.6 % |

By column width, justified: 254 px mean 9.8x (89 % over 2x), 285 px 7.9x, 347 px 6.4x, 439 px 5.7x. Tamil words are long (about 9 characters), so a column holds 3-5 words and all the slack goes into 2-4 gaps.
Chromium has no inter-character justification. **Body text is left-aligned.** `text-align:left` is in the template's `css_extra`; a paper that wants justified text with wider columns can change that one line and re-run the test (it asserts the numbers above only for the demo columns).

Column measure: Tamil sets `body.span_per_col: 2` (a story of N grid columns gets round(N/2) text columns), so the narrowest body column is 254 px (a 3-wide story in 2 columns). On the planned pages it holds **25.8 characters per line on average** (652 lines; tested: at least 24). Other columns: 285, 347, 439 px.

## Sizes

Page: broadsheet 381 x 578 mm, canvas 1520 px (1 px = 0.25 mm), 8 columns (160 px, gap 24 px), body column gap 22 px. Body starts at 14.5 px and steps down to 10.5 px (up to 20 px when growing; 0.25 px steps; the Latin template starts at 13 px), line height 1.55 (Tamil marks above and below the line need room); headlines Anek Tamil 800, line height 1.25, `17 px + 4 px x span` up to 42 px;
sub-head 18 px / 1.45; masthead 96 px. The planned pages settle at 11.25-13.75 px body (about 8-9.8 pt on paper). The fixture packs about 1,000 Tamil words on each page (one 400-word lead and four of about 160), which is dense; fewer words per page gives bigger text.

## Line breaks are the same in every context (proved)

The page is **laid out on the canvas** (1520 px) in every context and shown at another size by `transform: scale()`, never by CSS `zoom` and never by changing font sizes. Before this change the editor used `zoom` and the PDF `zoom: 0.947`; measured on the 8 pages, 5 of 8 pages broke some lines differently at zoom 0.5, 1.5 or 0.947 than at 1 (sub-pixel ties: a word that fits a line by 0.02 px at one zoom does not at another). The fill % changed with the zoom too, so the editor and the server could disagree about whether a page fitted.
Also fixed: the body size stored as pt (3 decimals) came back as 12.7504 px instead of 12.75 px (`storedBodyPx` now rounds to 2 decimals, the fit step), which shifted a word in rare cases.

Automated proof (real Chromium):

- `apps/editor/e2e-ta/linebreaks.spec.ts` (`pnpm --filter @epaper/editor e2e`, config `playwright.ta.config.ts`): the **real editor build** (vite preview) against a mock API serving the Tamil edition (8 planned pages + 2 proof pages: the 8 section headlines, and 8 representative paragraphs: short, medium with quote, long, digits/thousands, Latin acronyms `(GST) T20 AI`, quotes, three `ரூ.` amounts, hyphen-minus ranges `34-33`, `3-1`, `2-0`, `10-12`).
  Line by line (every line's full text, and its first word) at editor zoom **0.5, 1.0, 1.5**, on a 2x-density screen, and after pressing the zoom buttons: **2,706 lines identical** in every run.
  Those lines equal the lines of the **server PDF** (`exportScreenPdf`, text read with `pdftotext -bbox-layout`, each PDF word put on the editor line it sits on): 2,706 of 2,706 lines match and the first word is identical on all of them; no PDF word is left over.
  No line starts with a combining mark (vowel sign, pulli, anusvara, joiner) in the editor or the PDF. 330 text elements (headlines, kickers, sub-heads, paragraphs) come out of the PDF as the exact NFC text (compared with whitespace removed, see below). `pdffonts`: both families embedded. The editor fetched exactly the two font files from `/fonts`.
- `tests/ta-type/server-linebreaks.test.ts`: the headless render at zoom 0.5/1/1.5 and the PDF, same assertions.

What the comparison cannot see and why: poppler's word boundaries inside Tamil text are unreliable (it prints `வெள் ளப்` for `வெள்ளப்`: Type 3 glyph widths), so PDF text is compared with whitespace removed; spaces between words are not checked in the PDF. Line breaks, first words, characters and their order are.
Editing aids differ between editor and PDF: an **empty** sub-head or kicker slot shows a placeholder in the editor and takes room that the PDF does not (pre-existing behaviour of `renderPage({editable:true})`). The proof pages have all fields filled; autoplanned articles always have a sub-head (the standfirst).
The editor re-fits a page when it opens (starts at the template's start size, steps down) while autoplan may also grow the text to reach the target fill; a page opened by an editor can therefore get a different body size than autoplan chose, and the editor saves it. The PDF always prints the saved size.
Other browsers: Firefox and Safari are not tested; they run their own text shaper, so line breaks can differ from Chromium's in rare ties. The editor, the PDF and the e-paper use Chromium-class engines.

## Auto-plan, the 40 articles (through the connectors RSS adapter from `scripts/make-demo-site-ta.mjs`)

`autoPlan(..., {sectionPages: [...]})` is new and optional: page n = section n of the list (default for this paper: `section_order` in the template; sections not listed follow, listed sections without articles are skipped; a per-article `layout_hint.page` still wins).
The worker passes `section_order` and formats the strip date with the template's `date_format` ("நவம்பர் 24, 2026"); the API takes an optional `sections` list in `POST /v1/editions/:id/autoplan`. Each page is its own section, 5 articles; the balancer then grows or shrinks the body size to 85-100 %.

| page | section | no photo | lead photo (grey placeholder) |
|---|---|---|---|
| 1 | முதல் பக்கம் | 99 % (11.25 px) | 100 % (11 px) |
| 2 | தமிழ்நாடு | 99 % (12 px) | 99 % (12 px) |
| 3 | சென்னை | 98 % (13 px) | 99 % (12 px) |
| 4 | இந்தியா | 100 % (12.75 px) | 99 % (11.5 px) |
| 5 | உலகம் | 98 % (13.5 px) | 99 % (12.25 px) |
| 6 | வணிகம் | 98 % (13 px) | 100 % (12.25 px) |
| 7 | விளையாட்டு | 100 % (13.75 px) | 98 % (12.5 px) |
| 8 | சினிமா | 98 % (13 px) | 99 % (12.25 px) |

No overflow, nothing dropped, 40 of 40 placed, same plan on every run (`tests/ta-type/autoplan.test.ts`). Page 1 is the tightest (masthead + 1,031 words) and sits at the 11 px floor with a photo; a longer lead or a bigger photo would overflow it, and the fit would say so.

## IDML export

`POST /v1/editions/:id/exports {"format":"idml"}` (admin screen: "Make InDesign file (IDML)") makes a job; the worker takes the page snapshot, puts each photo's original from the files store into `Links/<asset id>.<ext>`, and writes **one zip** (`<paper>_<date>.zip`): `<paper>_<date>.idml` + `Links/`. Stored write-once in the files store, downloaded from `GET /v1/exports/:id/download`, status and plain-words log in `GET /v1/exports/:id`.
A photo that is not in the files store is still in the file as a frame with a missing link, and the log says so. WebP photos get a warning (InDesign before 2023 cannot place them).
Paragraph styles are named by our style names (`Story-head`, `Story-sub-head`, `Story-body`, `Story-kicker`, `Masthead`, `Strip`) so the operator's styles of the same name apply. Fonts are referenced by family name `Noto Serif Tamil` and `Anek Tamil`. Each Tamil style gets `Composer = HL Composer Optyca` (the World-Ready / Indic paragraph composer), `Hyphenation=false`, and the FontStyle from the template's `idml.font_styles` (`Story-head` = ExtraBold, bold bits = Bold, body = Regular).

What the tests prove (`tests/ta-type/idml.test.ts`, `packages/idml`): the zip layout (mimetype first, stored), well-formed XML, every reference resolves, every frame within 0.1 pt of the browser layout snapshot (measured 0.0000 pt), the Tamil text of every headline and paragraph is in the Stories as NFC, both family names are in Fonts.xml and the style definitions, the composer, the hyphenation flag and font styles are in Styles.xml, photos are in `Links/`, same input gives the same bytes.

**What cannot be proven without InDesign:** that InDesign opens the file without a repair dialog; that the fonts resolve; **how Tamil is shaped** (clusters, vowel-sign order) and **where InDesign breaks lines**; that `HL Composer Optyca` is the name InDesign accepts for the World-Ready composer; that variable-font instance names (`ExtraBold`) match. The browser and the PDF agree with each other; InDesign has its own composer.

### Check in InDesign (once per template, by a person)

1. Install both fonts (`templates/fonts/...`, the same files) on the InDesign machine. Open the .idml: no repair or missing-font dialog.
2. Window > Type > Paragraph Styles: `Story-head`, `Story-sub-head`, `Story-body`, `Story-kicker`, `Masthead`, `Strip` exist. `Story-head` uses Anek Tamil ExtraBold; `Story-body` Noto Serif Tamil Regular. If InDesign shows the variable instances under other names, set them in the style map.
3. Paragraph panel menu: the composer of the Tamil styles is "Adobe World-Ready Paragraph Composer"; hyphenation is off; alignment left.
4. Look at page 3 and page 7 next to the PDF: clusters are whole (vowel signs and pulli attached, `கொ`, `க்ஷ`, `ஸ்ரீ` look right), no boxes or missing glyphs, `ரூ.` and digits fine.
5. **Compare line breaks:** every line should start with the same word as in the PDF. InDesign may break some lines differently; note which, so the template widths or sizes can be adjusted. (The frames are the browser's boxes, so any difference is the composer's.)
6. Overset: no red plus on a frame that the page's fill meter called fitting; headline frames fit their lines.
7. Links panel: all photos linked when `Links/` sits beside the file; none missing.
8. Language: set the paragraph language to Tamil if hyphenation or spell check is used (the export does not set a language).
9. Update the style map if the paper's own InDesign styles have other names (`loadStyleMap`).
