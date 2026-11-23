# AI Coloring Book Studio

Plan, illustrate, lay out, validate and export print-ready coloring books for Amazon KDP, from one project brief. An original implementation of the capabilities found in AI book-creation products such as ColorCraft (see [Reference analysis](#reference-analysis)); no code, assets or branding were copied.

## Quick start (no accounts or API keys needed)

Requires Node.js 22.12+.

```bash
npm install
npm run build
npm start          # http://localhost:8790
```

Development with hot reload (API on 8790, UI on 5180):

```bash
npm run dev
```

With no keys the studio runs in **demo mode**: text comes from a template writer and pages are procedural placeholder drawings stamped "DEMO". Both are labelled everywhere (badges, banners, the validation report) and are never presented as AI output. Add keys to enable real generation:

| Variable | Service | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude (`claude-opus-5-5` by default) | concept, character bible, page plan, story rewrites, KDP listing text (structured outputs, validated with Zod) |
| `OPENAI_API_KEY` | OpenAI Images (`gpt-image-1` by default) | page illustrations, cover art, character references (reference images via `/images/edits`) |

Everything else is optional; see [.env.example](.env.example). Keys are read only on the server and never sent to the browser.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API + embedded worker + Vite dev server |
| `npm run build` | Production build (`dist/web`, `dist/server`) |
| `npm start` | Serve UI and API from one process |
| `npm test` | Run the test suite (Vitest; PGlite in memory, mocked providers) |
| `npm run typecheck` | TypeScript check |
| `npm run migrate` | Apply SQL migrations (also automatic at startup) |

## Architecture

```
web/            React 19 + Vite SPA (landing, wizard, dashboard, story, page studio, cover, export)
shared/         Pure, deterministic code used by BOTH browser and server
  kdp.ts          trim sizes, spine/cover/bleed/margin math (KDP rules)
  layout.ts       interior layout planner: front matter, blank backs, margins, content boxes
  settings.ts     Zod schemas for book settings, cover, metadata; validation types
server/
  app.ts, routes/   Fastify API: sessions + CSRF, rate limits, ownership checks
  services/         projects, pages (reorder/undo/lock), assets, usage/quota, artwork processing
  workflow/         durable job queue, worker, job handlers, export pipeline
  ai/               prompts, schemas + plan validation, text providers, image providers, demo art
  imaging/          PNG/JPEG codec, line-art quality analysis, print preparation (DPI, threshold)
  pdf/              interior + cover PDF builders (pdf-lib, embedded fonts), PDF inspector
  validation/       KDP validation engine
  db/               PGlite/PostgreSQL driver, migrations (reused from the sibling automation-studio project)
```

**Workflow** (deterministic steps, explicit inputs/outputs; no autonomous agents):
1. `plan_book`: brief → concept + character bible + page plan in one structured call → validated (`validatePlan`) → stored in a transaction
2. Illustration prompts are built deterministically from page + character bible (same style, line-art rules and character descriptions every page)
3. `generate_page` (one job per page): image provider → print preparation (upscale to 300 DPI, optional threshold to pure black/white) → automated quality checks → saved immediately
4. User review in the Page Studio: approve & lock, reject, regenerate, edit prompt, replace image, reorder, duplicate, delete, undo
5. `generate_cover_art`, `generate_metadata`
6. `export_book`: layout → interior PDF + cover PDF → re-open both PDFs and validate → ZIP package

**Jobs**: stored in PostgreSQL, claimed with `FOR UPDATE SKIP LOCKED`; bounded retries with exponential backoff (honoring `Retry-After`), idempotency keys (`gen:<page>:<generation>`), cancellation, progress, stale-job recovery after a crash. A page job that is superseded or locked meanwhile discards its result instead of overwriting.

**Provider interface** (`server/ai/image.ts`): `generateIllustration({ prompt, kind, aspectRatio, quality, referenceImages, outputFormat, seed })`. Adding a provider means implementing one class.

**Cover**: artwork is generated separately; the title, subtitle, author, back text and spine text are typeset with embedded Fredoka/Nunito fonts (SIL OFL) as vector text, never rendered by the image model. Dimensions come from `coverLayout()`; spine width = pages × per-paper multiplier, recalculated at every export.

## KDP rules implemented

Checked against KDP's public help pages in Nov 2026 (US-store paperback only; no hardcover, groundwood or non-US stores). Sources: [trim, bleed, margins](https://kdp.amazon.com/help/topic/GVBQ3CMEQW3W2VL6), [cover and spine](https://kdp.amazon.com/help/topic/G201953020), [barcodes](https://kdp.amazon.com/help/topic/G5HDYGP4BXLX4RUW), [submission guidelines](https://kdp.amazon.com/help/topic/G201857950), [images](https://kdp.amazon.com/help/topic/G202169030), [print options and page counts](https://kdp.amazon.com/help/topic/G201834180).

| Rule | Implementation |
|---|---|
| Trim sizes | All 16 standard sizes (5×8 … 8.5×11, A4, 8.25×6) plus custom sizes 4–8.5" wide × 6–11.69" tall |
| Page count | Per trim and paper: min 24 (72 standard color); max e.g. 828/776 (white/cream, most trims), 800/750 (8.25 sizes), 590/550 (8.5×11, 8.5×8.5), 780/730 (A4); standard color unavailable at A4. Custom trims use the stricter large-trim maximums and are flagged for manual confirmation |
| Interior page size | Trim; with bleed width +0.125", height +0.25" (whole book or none), verified by re-reading the PDF |
| Margins | Inside 0.375 / 0.5 / 0.625 / 0.75 / 0.875" by page-count tier; top, bottom, outside ≥ 0.25" (0.375" with bleed); raised automatically |
| Files | Single-page PDF, all fonts embedded, no metadata, annotations or encryption, ≤ 650 MB (cover ≤ 40 MB recommended), same orientation on every page, sequential pages |
| Fonts and lines | Text ≥ 7 pt (interior, cover, spine); line art ≥ 0.75 pt (measured from the print file) |
| Images | 300 DPI target, below 200 DPI is an error, images above 600 DPI are reduced; grayscale for black-ink books |
| Cover size | Width = bleed + back + spine + front + bleed; height = trim + 2 × 0.125" bleed |
| Spine | Pages × 0.002252" (white or standard color), 0.0025" (cream), 0.002347" (premium color); recalculated at every export |
| Spine text | 80+ pages (KDP's wording is inconsistent between 79 and 80, so the stricter value is used) and a spine wide enough for 7 pt text with 0.0625" clearance each side (about 91+ pages on white paper) |
| Cover text and barcode | Text ≥ 0.125" inside trim (laid out at 0.25"); 2" × 1.2" barcode area (KDP's minimum is 1.4" × 0.8") kept ≥ 0.25" from the spine and trim |

**Reported as "manual review"** (cannot be verified from the files): barcode position against KDP's template, maximum pages for custom trims, RGB cover vs. KDP's CMYK recommendation, whether KDP considers the blank backs of coloring pages "excessive blank pages", stray text, logos or watermarks inside artwork, and the AI-content disclosure KDP asks for at upload.

**Limits**: findings are `pass`, `warning`, `error` or `manual`. "Ready for review" means no blocking errors were found by these checks; it does not guarantee KDP acceptance. Always review both PDFs in KDP's Print Previewer. The app never uploads or publishes anything.

## Deployment

1. `npm ci && npm run build` on the server (Node 22.12+).
2. Set `DATABASE_URL` to PostgreSQL for production, `SECURE_COOKIES=true`, `TRUST_PROXY=true` behind a TLS proxy (Caddy/nginx), `PUBLIC_URL`, and provider keys.
3. `npm start` (or a process manager / container). Mount a persistent volume at `DATA_DIR` (object storage). For several instances replace `LocalStorage` (`server/storage.ts`, four methods) with S3/R2/GCS; run extra workers with `WORKER_MODE=off` on the API and a separate worker process that calls `startWorker` (PostgreSQL required).
4. Back up the database and `DATA_DIR/objects`.

## Reference analysis

Observed with the REA browser-scenario tool against the publicly accessible ColorCraft marketing, KDP-generator and docs pages (no login, paywall or access control was bypassed; the product itself was not used). Public capabilities mapped to this project: one-prompt book creation (coloring/storybook/puzzle), per-style consistency, trim sizes 8.5×11 … 5×8, batch page generation, WYSIWYG editor (swap art, reposition, regenerate a page), cover wrap with spine/back/2×2 thumbnails, listing generator (description + 20 keywords), lifestyle mockups, print ordering. Not implemented here: puzzle books, comic books, lifestyle mockups, printed-copy ordering, billing.

## Status

| Area | Status |
|---|---|
| Auth, projects, wizard, dashboard, story/character editing, page studio, cover studio, export & validation UI | Implemented, covered by API/e2e tests |
| Story/plan/listing generation with Claude | Implemented; **not exercised live** (no key available); tested through the demo provider and schema validation |
| Illustration generation with OpenAI Images | Implemented incl. reference images and error mapping; **not exercised live** |
| Demo providers | Working; output labelled DEMO |
| Interior/cover PDFs, validation | Implemented and tested against re-parsed PDFs; not verified in the real KDP Print Previewer |
| Character consistency | Prompt-level plus reference images where supported; **no guarantee** of identical characters |
| Not built | Puzzle/comic books, mockups, S3 storage adapter, email verification/password reset, billing |
