# Wayward House — Publishing HOWTO

How to create and publish essays, signals, and books. Covers file locations, frontmatter, JSON manifests, topic registration, and keeping Ask Pepper's knowledge up to date.

---

## Quick reference

| Content type | Source repo | JSON manifest | Live at |
|---|---|---|---|
| Essay | `wh-essays/essays/` | `wayward-house/src/content/essays/_essays.json` | `/essays/<slug>/` |
| Signal | `wh-signals/signals/` | `wayward-house/src/content/signals/_signals.json` | `/signals/<slug>/` |
| Book | `wh-<slug>/` | `wayward-house/src/content/books/_books.json` | `/<slug>/` |
| Topic | _(no source file)_ | `wayward-house/src/content/topics/_topics.json` | `/topics/<slug>/` |
| Image | _(no source file)_ | `wayward-house/src/content/images.ts` | _(referenced by id)_ |

The `wayward-house` Astro site reads from the JSON manifests. Nothing appears on the site until the JSON is updated — the source QMD/repo is the author's copy; the JSON entry is what publishes it.

---

## 1 · Essays

### 1.1 File location

```
wh-essays/
└── essays/
    └── <slug>.qmd        ← one file per essay, kebab-case slug
```

The `essays/` directory is its own git repo (`WaywardHouse/wh-essays`).

### 1.2 QMD frontmatter template

```yaml
---
title: "Essay Title Here"
subtitle: >
  One-sentence frame that earns the title. This becomes the dek on
  the listing page and the open-graph description.
date: YYYY-MM-DD
type: article
draft: true                  # change to false when publishing
article-series: <series-id>  # optional — groups essays into a series
article-sequence: 1          # optional — position within the series
topics: [Health Geography]   # display label(s) — not the slug
tags:
  - alberta
  - tag-hash-viz             # add if essay has interactive charts
  - tag-hash-story           # add if essay uses scrollytelling maps
  - tag-hash-pyodide         # add if essay uses Pyodide cells
image: /assets/images/<slug>.webp
toc: true
description: >
  Two-sentence description for search and metadata.
body-classes: "reading-body tag-hash-viz tag-hash-story"
interactive:
  charts: true               # enables ECharts loader
  story: true                # enables Scrollama + Mapbox loader
  mapbox: true               # enables Mapbox GL
---
```

**Tag conventions**

| Tag | Loads |
|---|---|
| `tag-hash-viz` | ECharts (`data-viz="echarts"`) |
| `tag-hash-story` | Scrollama + Mapbox story scroll |
| `tag-hash-mapbox` | Mapbox standalone map |
| `tag-hash-pyodide` | Pyodide runtime (Python in browser) |

Only include the tags you actually use — each tag triggers a CDN load.

### 1.3 Essay QA checklist

Before setting `draft: false`:

- [ ] Prose word count ≥ 3,500 (strip frontmatter and HTML data blocks from the count)
- [ ] Subtitle reads as a complete, standalone sentence
- [ ] All `data-viz`, `data-map`, and story section HTML is closed and balanced
- [ ] Interactive charts have `class="viz-caption"` source notes beneath them
- [ ] No inline `style=""` attributes use hard-coded colours — use `var(--wh-*)` tokens
- [ ] **References QA passed** — see §1.4 below

### 1.4 References and bibliography

Essays must be grounded in verifiable sources. Every factual claim tied to external data, a regulatory body, a published study, or a statistical assertion should carry a citation. The references section is a credibility signal, not a formality.

**Workflow**

Citations use Quarto's native bibliography system — Pandoc-style `[@citation-key]` markers resolved against a BibTeX file at render time. Do not replace them with manual superscripts.

| File | Location | Purpose |
|---|---|---|
| `references.bib` | `wh-essays/essays/references.bib` | Shared BibTeX database for all essays |
| `chicago-author-date.csl` | `wh-essays/essays/chicago-author-date.csl` | Citation style (Chicago author-date) |

Both files are shared across all essays. Essays that carry no citations need not declare either.

**Frontmatter for essays with citations**

```yaml
bibliography: references.bib
csl: chicago-author-date.csl
link-citations: true
```

**BibTeX entry types to use**

| Source type | Entry type |
|---|---|
| Peer-reviewed journal article | `@article` |
| Government / institutional report | `@techreport` |
| Industry document, press release, dataset | `@misc` |
| Book | `@book` |
| Book chapter | `@incollection` |

Always include `url` + `urldate` on web-sourced entries. Always include `doi` on journal articles where one exists.

**References QA — before publishing**

- [ ] Every `[@citation-key]` in the essay body has a matching entry in `references.bib`
- [ ] Every `@techreport` and `@misc` entry has a `url` field pointing to a live, public source
- [ ] Every `@article` entry has either a `doi` or a `url` field
- [ ] No entry uses a paywall-only URL without also citing the DOI
- [ ] The essay ends with a `## References` section containing `{#refs}` — Quarto populates this automatically
- [ ] A local render passes without bibliography warnings: `quarto render <slug>.qmd`
- [ ] The rendered HTML `## References` section is not empty
- [ ] Spot-check: open 2–3 of the URLs in the rendered reference list and confirm they resolve

### 1.4 Adding to the JSON manifest

Add an entry to **`wayward-house/src/content/essays/_essays.json`** at the top of the array (newest first).

```json
{
  "id": "the-slug-matching-filename",
  "title": "Essay Title Here",
  "dek": "One-sentence dek — matches subtitle in QMD.",
  "pubDate": "YYYY-MM-DD",
  "topic": "Geography",
  "topics": ["physical-geography", "economic-geography"],
  "readTime": 15,
  "heroImage": "geo-04",
  "heroTreatment": "caption-bar",
  "coords": "52.1°N · 114.1°W",
  "featured": false,
  "draft": false,
  "author": "Paul Hobson"
}
```

**Required fields:** `id`, `title`, `pubDate`, `topic`, `draft`

**`topic`** — single display string shown in the listing (`"Geography"`, `"Economy"`, `"Energy"`).

**`topics`** — array of topic slugs from `_topics.json` (see §5). Drives the topic filter pages.

**`readTime`** — minutes. Estimate: 240 words/min. At 3,500 prose words ≈ 15 min.

**`heroImage`** — image manifest id. See §6 for the full list.

**`heroTreatment`** — `"raw"` · `"warm"` · `"duotone"` · `"caption-bar"`. Match to the image's `defaultTreatment` in `images.ts` unless you have a reason to override.

**`featured: true`** — promotes the essay to the homepage hero slot. Only one essay should be featured at a time; set the previous one back to `false`.

### 1.5 Landing page impact

No template changes are needed. The home page, essays index, and topic pages all derive from the JSON collection:

- **Homepage hero** — `allEssays[0]` (or the entry with `featured: true` if one exists)
- **Homepage recent grid** — the next 6 essays after the hero
- **`/essays/` index** — full list, sorted by `pubDate` descending
- **`/topics/<slug>/`** — auto-filtered by `topics` array

---

## 2 · Signals

### 2.1 File location

```
wh-signals/
└── signals/
    └── issue-NNN.qmd      ← zero-padded three-digit issue number
```

The `signals/` directory is its own git repo (`WaywardHouse/wh-signals`).

### 2.2 QMD frontmatter template

```yaml
---
title: System Signals No. N
subtitle: >
  Three-clause summary of this issue's defining move.
date: YYYY-MM-DD
issue: N
description: >
  Two-sentence description for search and metadata.
categories:
  - "Economic Geography"
  - "Trade Policy"
image: assets/images/signals.webp
toc: true
---
```

**Signals structure** — each issue opens with a `> **Published …**` blockquote, then a `## This Week's Pattern` section. Footnotes are `[^n]` style (Pandoc footnotes, not superscript). Sections are named after the system being analysed, not news events.

### 2.3 Adding to the JSON manifest

Add an entry to **`wayward-house/src/content/signals/_signals.json`** at the top of the array.

```json
{
  "id": "issue-NNN",
  "issue": N,
  "title": "System Signals No. N",
  "pubDate": "YYYY-MM-DD",
  "topic": "Economy",
  "summary": "One sentence. The defining move of the week.",
  "bullets": [
    "First headline observation.",
    "Second headline observation.",
    "Third headline observation."
  ],
  "heroImage": "sys-01",
  "draft": false
}
```

**Required fields:** `id`, `issue`, `title`, `pubDate`, `topic`, `summary`, `draft`

`bullets` — 3 short declarative strings. Shown in the signals listing as a preview.

### 2.4 Landing page impact

- **`/signals/` index** — auto-populates from the JSON, latest issue first
- **Homepage** — the latest signal appears in the signals strip if the template includes it

---

## 3 · Books

### 3.1 Repository setup

Each book is a Quarto book project in its own repo. The naming convention is `wh-<slug>`.

**Minimum repo structure:**

```
wh-<slug>/
├── _extensions/
│   └── WaywardHouse/
│       └── waywardhouse-book/   ← theme extension (copy from any existing book repo)
├── _metadata.yml                ← bibliography defaults
├── _quarto.yml                  ← book config, chapter list
├── assets/                      ← CSS, JS, includes (copy from existing book repo)
├── references/
│   └── wayward-house.bib
└── index.qmd
```

**`_quarto.yml` minimum:**

```yaml
project:
  type: book
  output-dir: _site

book:
  title: "Book Title"
  subtitle: "One-line frame"
  date: last-modified
  sidebar:
    tools:
      - icon: house
        href: /
        aria-label: Wayward House home
      - icon: grid
        href: /learn/
        aria-label: Library
      - icon: github
        href: https://github.com/WaywardHouse/wh-<slug>
        aria-label: Source on GitHub
  chapters:
    - index.qmd
    - part: "Part Title"
      chapters:
        - section/chapter-one.qmd

format:
  WaywardHouse/waywardhouse-book-html:
    number-sections: false
    include-after-body:
      - assets/includes/book-viz-loader.html

execute:
  freeze: auto
```

**Installing the theme extension in a fresh repo:**

```bash
quarto add WaywardHouse/waywardhouse-site
```

Or copy `_extensions/WaywardHouse/waywardhouse-book/` from any existing book repo for an offline install.

### 3.2 Chapter frontmatter

```yaml
---
title: "Chapter Title"
subtitle: "Optional one-liner"
---
```

Books use minimal frontmatter. The `_metadata.yml` at the repo root applies bibliography settings to all chapters:

```yaml
bibliography: references/wayward-house.bib
link-citations: true
reference-location: document
citation-location: document
```

### 3.3 Adding to the JSON manifest

Add an entry to **`wayward-house/src/content/books/_books.json`**.

```json
{
  "id": "book-slug",
  "n": "07",
  "title": "Book Title",
  "slug": "book-slug",
  "status": "scaffolded",
  "statusLabel": "Scaffolded · 0 chapters",
  "description": "Two sentences. What this book covers and who it's for.",
  "topics": ["Earth systems", "GIS"],
  "cover": {
    "mode": "photo",
    "color": "#1a2a3a",
    "image": "geo-02",
    "kicker": "Short Kicker"
  },
  "repo": "WaywardHouse/wh-book-slug",
  "deployUrl": "https://wayward.house/book-slug/",
  "chapters": [
    { "n": "1", "part": "I · Foundations", "title": "Chapter one title" }
  ],
  "featured": false
}
```

**`status`** values and their meaning:

| Value | Meaning |
|---|---|
| `flagship` | Primary book, fully active |
| `active` | Live, being actively written |
| `drafting` | In progress, some chapters live |
| `scaffolded` | Structure exists, little content |
| `companion` | Reference/supplement to another book |

**`n`** — two-digit string (`"07"`). Controls display order in the library.

### 3.4 Landing page impact

- **`/library/` page** — lists all books from `_books.json` sorted by `n`
- **Homepage books strip** — shows the entry with `featured: true`; update `featured` when a book is ready to promote

### 3.5 Cloudflare deployment

Each book repo deploys to Cloudflare Pages. After creating the GitHub repo:

1. Connect it to Cloudflare Pages (build command: `quarto render`, output: `_site`)
2. Add a routing rule in the Cloudflare dashboard to proxy `wayward.house/<slug>/*` to the Pages deployment
3. Update `deployUrl` in `_books.json` once the route is live

---

## 4 · Updating an existing book entry

To update the chapter list, status label, or description without rebuilding anything:

1. Edit **`wayward-house/src/content/books/_books.json`** directly
2. Redeploy `wayward-house` (push to main — Cloudflare Pages builds automatically)

No template changes needed.

---

## 5 · Topics

Topics power the `/topics/<slug>/` filter pages and the chip links on essay cards.

### 5.1 Adding a new topic

Edit **`wayward-house/src/content/topics/_topics.json`**:

```json
{
  "id": "topic-slug",
  "title": "Topic display name",
  "slug": "topic-slug",
  "pillar": "Geography",
  "description": "One sentence. What this topic covers."
}
```

**`pillar`** — must be one of: `Geography` · `Economy` · `Energy` · `Systems` · `Places` · `Cartographic`

The `slug` and `id` must match. The route `/topics/<slug>/` is generated automatically from the slug.

### 5.2 Available topics

```
energy-systems · watersheds · cartography · spatial-data · western-canada
risk · modelling · places · economic-geography · physical-geography
urban-geography · environmental-geography · historical-geography
monitoring · infrastructure · energy-policy · trade-policy
health-geography · human-geography
```

Always check this list before creating a new topic — avoid near-duplicates.

---

## 6 · Images

The image manifest lives at **`wayward-house/src/content/images.ts`**. Every `heroImage` field in the JSON manifests must reference an id from this file.

### Available image IDs

| Pillar | IDs | Subjects |
|---|---|---|
| Geography | `geo-01` `geo-02` `geo-03` `geo-04` | Braided river · Glacial valley · Fjord coastline · Prairie road |
| Energy | `egy-01` `egy-02` `egy-03` `egy-04` | Transmission corridor · Wind turbines · Refinery dawn · Solar array |
| Systems | `sys-01` `sys-02` `sys-03` `sys-04` | Data hall cables · Circuit macro · Nodes/threads · Terminal amber |
| Places | `pl-01` `pl-02` `pl-03` `pl-04` | Rural station · Hands on topo · Industrial town · Port cranes |
| Cartographic | `crt-01` `crt-02` `crt-03` `crt-04` | Contour sheet · Nautical chart · Topo oblique · Schematic B&W |

### Default treatments by pillar

`geo-*` → `warm` or `duotone` · `egy-*` → `duotone` · `sys-*` → `duotone` · `pl-*` → `warm` or `caption-bar` · `crt-*` → `raw`

Match the image's `defaultTreatment` in `images.ts` unless there's a specific reason to override.

---

## 7 · Ask Pepper — vectorization

Pepper answers questions by searching a Cloudflare Vectorize index (`wh-content`) populated from essay and signal QMD files. **New content is not available to Pepper until the index is updated.**

### 7.1 What gets indexed

- All `.qmd` files in `wh-essays/essays/` except `index.qmd`
- All `.qmd` files in `wh-signals/signals/` except `index.qmd`

Books and chapters are not currently indexed.

The indexing pipeline:
1. Strips frontmatter, code blocks, and HTML from the QMD body
2. Splits the clean text into overlapping ~400-character chunks
3. Embeds each chunk via Cloudflare Workers AI (`@cf/baai/bge-small-en-v1.5`)
4. Upserts vectors to the `wh-content` Vectorize index

### 7.2 Running the ingest

**Prerequisites:**

```bash
export CLOUDFLARE_ACCOUNT_ID=your_account_id
export CLOUDFLARE_API_TOKEN=your_api_token   # needs Workers AI + Vectorize write
npx wrangler login                           # if using wrangler auth instead
```

**Dry run first** (shows what will be indexed, writes nothing):

```bash
cd wayward-house
node scripts/ingest-vectors.js --dry-run
```

**Full ingest** (embeds all essays and signals and upserts to Vectorize):

```bash
node scripts/ingest-vectors.js
```

The script processes every QMD file it finds — there is no incremental mode. Re-running overwrites existing vectors for updated content (ids are deterministic: `<type>__<slug>__<chunk_n>`).

### 7.3 When to run

Run the ingest after:
- Publishing a new essay
- Publishing a new signal
- Making significant edits to an existing essay or signal

You do not need to run it for book content, topic/manifest changes, or CSS/JS fixes.

### 7.4 Content bundle (for the ingest worker)

A separate script builds a static JS bundle used by the Cloudflare ingest worker:

```bash
cd wayward-house
node scripts/build-content-bundle.js
```

This writes `scripts/content-bundle.js`. Run this before deploying the ingest worker if you've added new content files. It is **not** required for the `ingest-vectors.js` script above, which reads the QMD files directly.

---

## 8 · End-to-end publishing checklists

### Essay

```
[ ] Write essay in wh-essays/essays/<slug>.qmd
[ ] References QA (§1.4):
      [ ] All [@citation-key] markers have entries in references.bib
      [ ] All entries have url or doi — no unverifiable assertions
      [ ] quarto render <slug>.qmd passes cleanly
      [ ] Rendered ## References section is not empty
      [ ] Spot-check 2–3 URLs resolve
[ ] Set draft: false in QMD frontmatter
[ ] Prose ≥ 3,500 words
[ ] Add entry to wayward-house/src/content/essays/_essays.json (top of array)
[ ] Confirm topics[] slugs exist in _topics.json — add any new ones
[ ] Pick heroImage from §6 image table
[ ] Set featured: true if promoting to homepage hero
       (and set previous featured essay back to false)
[ ] Commit and push wh-essays — Cloudflare Pages redeploys wh-essays.pages.dev
[ ] Commit and push wayward-house — Cloudflare Pages redeploys hub
[ ] Run: cd wayward-house && node scripts/ingest-vectors.js
```

### Signal

```
[ ] Write issue in wh-signals/signals/issue-NNN.qmd
[ ] Add entry to wayward-house/src/content/signals/_signals.json (top of array)
[ ] Confirm issue number is sequential
[ ] Push wayward-house
[ ] Run: cd wayward-house && node scripts/ingest-vectors.js
```

### New book

```
[ ] Create repo wh-<slug> with _quarto.yml, _extensions/, assets/, index.qmd
[ ] Install theme: quarto add WaywardHouse/waywardhouse-site
    (or copy _extensions/ from an existing book repo)
[ ] Add entry to wayward-house/src/content/books/_books.json
[ ] Create GitHub repo, connect to Cloudflare Pages
[ ] Add Cloudflare routing rule: wayward.house/<slug>/* → Pages deployment
[ ] Set status: "scaffolded" until chapters are live; update statusLabel as chapters ship
[ ] Push wayward-house
```

---

## 9 · File locations at a glance

```
~/src/websites/
├── wh-essays/
│   └── essays/
│       └── <slug>.qmd                  ← essay source
├── wh-signals/
│   └── signals/
│       └── issue-NNN.qmd               ← signal source
├── wh-<book>/
│   ├── _quarto.yml                     ← book config + chapter list
│   ├── _extensions/WaywardHouse/
│   │   └── waywardhouse-book/
│   │       └── theme.scss              ← shared theme (edit once, copy to all repos)
│   └── <section>/<chapter>.qmd         ← chapter source
└── wayward-house/
    └── src/
        └── content/
            ├── essays/_essays.json     ← essay manifest
            ├── signals/_signals.json   ← signal manifest
            ├── books/_books.json       ← book manifest
            ├── topics/_topics.json     ← topic registry
            └── images.ts               ← image manifest
    └── scripts/
        ├── ingest-vectors.js           ← Pepper vectorization
        └── build-content-bundle.js     ← ingest worker bundle
```
