# Tamil demo paper: தென்பொதிகை (Thenpothigai Daily)

A **fictional** Tamil daily used only to demo E-Paper Desk with a Tamil source. Sample issue of 2026-11-24, 8 broadsheet pages,
one section per page: முதல் பக்கம், தமிழ்நாடு, சென்னை, இந்தியா, உலகம், வணிகம், விளையாட்டு, சினிமா. 40 articles (5 per section).

**Written by an AI model. A native Tamil reader must review language and idiom before this is shown to Tamil readers.**

## What is fiction

Everything. Every article is original fiction written for this demo. No text is copied from or paraphrased after any real paper.
People, companies, film titles, teams, scores, officials and quotes are invented. Real *places* (Madurai, Chennai neighbourhoods,
Marina, the Cauvery, Pothigai hills) appear only in harmless civic, weather, transport, nature and culture stories.

## Rules the content follows (checked by `tests/ta-content`)

1. All fiction; no real paper, party, politician, public body, company or team is named.
2. No communal or religious controversy, no violence against named people, no medical or financial advice presented as fact.
3. Photos are real stock/free-licence pictures of places, objects, crowds, nature or sport. Captions say so
   ("கோப்புப் படம்: ...") and never claim a photo shows a fictional event or person.
4. Business and sport use invented firms, teams and scores.
5. Tamil script is at least 85 % of letters in every headline and body (the test holds it to 95 %); Latin letters in headlines only for a short acronym allow-list; Arabic digits; currency as ரூ.
6. Bands (Tamil words in the body): 6 short (60-110), 26 medium (150-300), 8 long (400-700, 3-6 paragraphs, one pull quote), one long per section.

## Files

- `articles.ta.json`: the source of truth (`standin: true`). Fields per article: id `ta-001..ta-040`, section, page, priority 1-5, headline,
  standfirst, byline, dateline, published_at (+05:30), body[], pull_quote, caption, `image_hint` (English keywords for the photo step), `image_file` (null until the photo step fills it).
- `site/`: generated static site (do not hand-edit). Rebuild: `node scripts/make-demo-site-ta.mjs` (no network). It writes `index.html`, `sections/*.html`, `news/ta-NNN.html`,
  `rss.xml` (RSS 2.0, `content:encoded`, `dc:creator`, category = section name, `<language>ta</language>`, `media:content` once `image_file` is set), `sitemap.xml`, `robots.txt`.
  Absolute links use the placeholder `http://127.0.0.1:8190`, like `fixtures/demo-site`. Images are referenced as `/img/<image_file>` and are not created here.
- The dateline opens the first paragraph in the feed (`மதுரை: ...`); the pull quote follows paragraph 2 as a blockquote.

## Notes for the wizard / connector

- Set `lang: const:ta` and `script: const:Taml` in the mapping: the adapter's `detectScript` does not know Tamil yet and reports `en`/`Latn`.

## Test

`npx vitest run -c vitest.stack.config.ts tests/ta-content`
