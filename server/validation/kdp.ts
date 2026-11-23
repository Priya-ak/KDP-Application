import {
  COVER_TEXT_MIN_INSET,
  COVER_RECOMMENDED_BYTES,
  MAX_PDF_BYTES,
  MIN_FONT_PT,
  MIN_ACCEPTABLE_DPI,
  PAPER_TYPES,
  TARGET_DPI,
  findTrim,
  pageLimits,
  rectContains,
  rectsIntersect,
  requiredInsideMargin,
  requiredOutsideMargin,
  spineWidth,
  trimBox,
  type CoverLayout,
  type Rect,
} from "../../shared/kdp.ts";
import type { BookMetadata, BookSettings, CheckStatus, ValidationFinding, ValidationReport } from "../../shared/settings.ts";
import type { CoverReport } from "../pdf/cover.ts";
import type { PdfInspection } from "../pdf/inspect.ts";
import type { InteriorReport } from "../pdf/interior.ts";
import type { InteriorPlan } from "../../shared/layout.ts";

export interface ValidationPageInfo {
  id: string;
  position: number;
  status: string;
  isDemo: boolean;
  sha256: string | null;
  qualityStatus: string | null;
  qualityMessages: string[];
  storyIndex: number | null;
}

export interface ValidationInput {
  settings: BookSettings;
  plan: InteriorPlan;
  interior: InteriorReport;
  interiorPdf: PdfInspection;
  coverLayout: CoverLayout;
  cover: CoverReport;
  coverPdf: PdfInspection;
  pages: ValidationPageInfo[];
  coverArtIsDemo: boolean;
  hasCoverArt: boolean;
  metadata: BookMetadata;
}

const PROHIBITED_LISTING = /(https?:\/\/|www\.|@[a-z0-9-]+\.[a-z]|best ?seller|#1|free shipping|on sale|discount|limited time|review this|leave a review|5 stars?)/i;
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const list = (nums: number[], max = 12) => (nums.length > max ? `${nums.slice(0, max).join(", ")} and ${nums.length - max} more` : nums.join(", "));

/**
 * Checks the generated interior and cover against KDP paperback rules.
 * Findings are pass / warning / error / manual (requires human review).
 * A book is "ready for review" only with zero errors — and even then KDP's
 * own Print Previewer remains the final authority, so that check is always
 * reported as manual.
 */
export function validateBook(input: ValidationInput): ValidationReport {
  const { settings, plan, interior, interiorPdf, coverLayout: L, cover, coverPdf } = input;
  const findings: ValidationFinding[] = [];
  const add = (f: ValidationFinding) => findings.push(f);
  const paper = PAPER_TYPES[settings.paper];
  const pageCount = plan.pageCount;

  // PDF integrity -------------------------------------------------------------
  for (const [label, pdf] of [["Interior", interiorPdf], ["Cover", coverPdf]] as const) {
    if (!pdf.readable) add({ id: `pdf_${label.toLowerCase()}`, category: "PDF integrity", status: "error", title: `${label} PDF cannot be opened`, detail: pdf.error ?? "Unreadable file.", fix: "Re-run the export. If it keeps failing, report the error." });
    else if (pdf.bytes > MAX_PDF_BYTES) add({ id: `pdf_${label.toLowerCase()}`, category: "PDF integrity", status: "error", title: `${label} PDF is larger than 650 MB`, detail: `${(pdf.bytes / 1048576).toFixed(0)} MB.`, fix: "Reduce the number of pages or image resolution." });
    else add({ id: `pdf_${label.toLowerCase()}`, category: "PDF integrity", status: "pass", title: `${label} PDF opens and parses`, detail: `${pdf.pageCount} page(s), ${(pdf.bytes / 1048576).toFixed(1)} MB.` });
  }
  if (interiorPdf.readable && interiorPdf.pageCount !== pageCount)
    add({ id: "pdf_page_count_match", category: "PDF integrity", status: "error", title: "Interior PDF page count differs from the layout", detail: `PDF has ${interiorPdf.pageCount}, layout expects ${pageCount}.`, fix: "Re-run the export." });
  if (coverPdf.readable && coverPdf.pageCount !== 1) add({ id: "cover_single_page", category: "PDF integrity", status: "error", title: "Cover PDF must be a single page", detail: `Found ${coverPdf.pageCount} pages.`, fix: "Re-run the export." });

  // KDP file hygiene: no metadata, annotations, encryption; cover under 40 MB recommended ---------
  for (const [label, pdf] of [["Interior", interiorPdf], ["Cover", coverPdf]] as const) {
    if (!pdf.readable) continue;
    const problems = [pdf.hasMetadata ? "document metadata" : "", pdf.annotationPages.length ? `annotations or links on page(s) ${list(pdf.annotationPages)}` : ""].filter(Boolean);
    if (problems.length) add({ id: `hygiene_${label.toLowerCase()}`, category: "PDF integrity", status: "warning", title: `${label} PDF contains ${problems.join(" and ")}`, detail: "KDP asks for files without metadata, annotations, comments, bookmarks or crop marks.", fix: "Re-run the export, or optimize the PDF." });
  }
  if (coverPdf.readable && coverPdf.bytes > COVER_RECOMMENDED_BYTES) add({ id: "cover_size_mb", category: "PDF integrity", status: "warning", title: "Cover PDF is larger than 40 MB", detail: `${(coverPdf.bytes / 1048576).toFixed(0)} MB; KDP recommends 40 MB or less.`, fix: "Use smaller cover art." });
  if (coverPdf.encrypted || interiorPdf.encrypted) add({ id: "encrypted", category: "PDF integrity", status: "error", title: "Encrypted PDF", detail: "KDP rejects locked or encrypted files.", fix: "Re-run the export." });

  // Page count ------------------------------------------------------------------
  const trim = findTrim(settings.trimSize);
  const limits = trim ? pageLimits(settings.trimSize, settings.paper) : null;
  if (limits && !limits.available)
    add({ id: "page_count", category: "Page count", status: "error", title: `${paper.label} is not available at this trim size`, detail: `KDP does not offer this ink and paper at ${trim!.label}.`, fix: "Choose another paper type or trim size in book settings." });
  else if (limits && pageCount < limits.min)
    add({ id: "page_count", category: "Page count", status: "error", title: `Too few pages for ${paper.label.toLowerCase()}`, detail: `The interior has ${pageCount} pages; KDP requires at least ${limits.min}.`, fix: `Add ${limits.min - pageCount} more pages (more illustrations, front matter, or turn on blank backs).` });
  else if (limits && pageCount > limits.max)
    add({ id: "page_count", category: "Page count", status: "error", title: "Too many pages for this trim and paper", detail: `The interior has ${pageCount} pages; KDP's maximum for ${trim!.label} on ${paper.label.toLowerCase()} is ${limits.max}.`, fix: "Split the book into volumes or choose a smaller trim size." });
  else if (limits) add({ id: "page_count", category: "Page count", status: "pass", title: "Page count within KDP limits", detail: `${pageCount} pages (allowed ${limits.min}–${limits.max} for ${trim!.label} on ${paper.label.toLowerCase()}).` });
  if (pageCount % 2 !== 0) add({ id: "page_count_even", category: "Page count", status: "warning", title: "Odd page count", detail: "KDP adds a blank page at the end of odd-length interiors.", fix: "Add or remove one page." });
  if (limits?.approximate) add({ id: "page_count_custom", category: "Page count", status: "manual", title: "Confirm page limits for a custom trim", detail: "KDP doesn't publish page-count maximums for custom trim sizes; the stricter large-trim limits were used.", fix: "Check the limit in KDP's page-count table for your custom size when you set up the book." });

  // Trim size ------------------------------------------------------------------
  add(trim ? { id: "trim_size", category: "Trim size", status: "pass", title: trim.custom ? "Custom trim within KDP's limits" : "Standard KDP trim size", detail: trim.custom ? `${trim.label}; KDP allows width 4"–8.5" and height 6"–11.69".` : trim.label } : { id: "trim_size", category: "Trim size", status: "error", title: "Unsupported trim size", detail: settings.trimSize, fix: "Choose a standard KDP trim size or a custom size within 4–8.5 in wide and 6–11.69 in tall." });
  if (trim && (trim.width > 6.12 || trim.height > 9)) add({ id: "trim_large", category: "Trim size", status: "manual", title: "Large trim size printing cost", detail: "Trims wider than 6.12\" or taller than 9\" are 'large' in KDP's pricing, which changes printing cost and royalties.", fix: "Check the print cost and your list price in KDP's pricing step." });

  // Interior page dimensions ------------------------------------------------------
  const wrongSize = interiorPdf.pageSizes.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => !near(s.width, plan.pageSize.width) || !near(s.height, plan.pageSize.height));
  if (wrongSize.length) add({ id: "interior_dimensions", category: "Interior dimensions", status: "error", title: "Some interior pages have the wrong size", detail: `Pages ${list(wrongSize.map((w) => w.n))} differ from ${plan.pageSize.width}" × ${plan.pageSize.height}".`, fix: "Re-run the export.", pages: wrongSize.map((w) => w.n) });
  else if (interiorPdf.readable) add({ id: "interior_dimensions", category: "Interior dimensions", status: "pass", title: "Interior page size matches the trim", detail: `${plan.pageSize.width}" × ${plan.pageSize.height}"${settings.bleed ? " (trim + bleed on top, bottom and outside edge)" : " (no bleed)"}.` });

  // Bleed --------------------------------------------------------------------------
  const pastTrim = interior.pages.filter((p) => p.elements.some((e) => !rectContains(trimBox(plan.trim, settings.bleed, p.number), e, 0.001))).map((p) => p.number);
  if (pastTrim.length && !settings.bleed)
    add({ id: "bleed", category: "Bleed", status: "error", title: "Content reaches the page edge without bleed", detail: `Pages ${list(pastTrim)}.`, fix: "Turn on bleed in book settings, or keep content inside the margins.", pages: pastTrim });
  else
    add(settings.bleed
      ? { id: "bleed", category: "Bleed", status: "pass", title: "Bleed layout applied to the whole interior", detail: "Every page is 0.125\" wider and 0.25\" taller than the trim, as KDP requires when any page uses bleed. Artwork stays inside the margins, so nothing is trimmed off." }
      : { id: "bleed", category: "Bleed", status: "pass", title: "No-bleed layout", detail: "All content stays inside the margins; nothing needs to extend to the trim edge." });

  // Margins & gutter ----------------------------------------------------------------
  const insideNeeded = requiredInsideMargin(pageCount);
  const outsideNeeded = requiredOutsideMargin(settings.bleed);
  const m = plan.margins;
  if (m.inside + 1e-6 < insideNeeded || Math.min(m.top, m.bottom, m.outside) + 1e-6 < outsideNeeded)
    add({ id: "margins", category: "Margins & gutter", status: "error", title: "Margins below KDP minimums", detail: `Need inside ≥ ${insideNeeded}" and outside ≥ ${outsideNeeded}".`, fix: "Increase the margins in book settings." });
  else add({ id: "margins", category: "Margins & gutter", status: "pass", title: "Margins and gutter meet KDP minimums", detail: `Inside ${m.inside}" (needs ${insideNeeded}" at ${pageCount} pages), top ${m.top}", bottom ${m.bottom}", outside ${m.outside}" (needs ${outsideNeeded}").` });
  const outsideLive = interior.pages.filter((p) => p.elements.some((e) => !rectContains(plan.pages[p.number - 1]!.live, e, 0.02))).map((p) => p.number);
  if (outsideLive.length) add({ id: "live_area", category: "Margins & gutter", status: "error", title: "Content placed outside the margins", detail: `Pages ${list(outsideLive)}.`, fix: "Shorten the text or reduce the font size on those pages.", pages: outsideLive });
  else add({ id: "live_area", category: "Margins & gutter", status: "pass", title: "All content inside the live area", detail: "Every image and text block is within the margins." });

  // Image resolution & clipping ---------------------------------------------------
  const lowDpi = interior.pages.filter((p) => p.image && p.image.dpi < MIN_ACCEPTABLE_DPI).map((p) => p.number);
  const midDpi = interior.pages.filter((p) => p.image && p.image.dpi >= MIN_ACCEPTABLE_DPI && p.image.dpi < TARGET_DPI).map((p) => p.number);
  const dpis = interior.pages.filter((p) => p.image).map((p) => p.image!.dpi);
  if (lowDpi.length) add({ id: "image_resolution", category: "Image resolution", status: "error", title: `Images below ${MIN_ACCEPTABLE_DPI} DPI`, detail: `Pages ${list(lowDpi)} will print blurry.`, fix: "Regenerate at higher quality or upload higher-resolution artwork.", pages: lowDpi });
  else if (midDpi.length) add({ id: "image_resolution", category: "Image resolution", status: "warning", title: `Some images below the recommended ${TARGET_DPI} DPI`, detail: `Pages ${list(midDpi)}.`, fix: "Regenerate those pages at higher quality or replace them.", pages: midDpi });
  else if (dpis.length) add({ id: "image_resolution", category: "Image resolution", status: "pass", title: `All images at ${TARGET_DPI}+ DPI`, detail: `Lowest effective resolution ${Math.min(...dpis)} DPI.` });
  const clipped = interior.pages.filter((p) => p.image && !rectContains(p.image.box, p.image.rect, 0.01)).map((p) => p.number);
  if (clipped.length) add({ id: "image_clipping", category: "Image clipping", status: "error", title: "Images extend past their boxes", detail: `Pages ${list(clipped)}.`, fix: "Re-run the export.", pages: clipped });
  else add({ id: "image_clipping", category: "Image clipping", status: "pass", title: "No images are cropped", detail: "Each illustration is scaled to fit its box with its aspect ratio preserved." });
  const thin = input.pages.filter((p) => p.qualityMessages.some((m) => /thin lines/i.test(m))).map((p) => p.position);
  if (thin.length) add({ id: "line_weight", category: "Image resolution", status: "warning", title: "Lines thinner than KDP's 0.75 pt minimum", detail: `Content pages ${list(thin)} have very fine lines that may not print.`, fix: "Regenerate those pages with bolder outlines (Simple or Medium complexity).", pages: thin });
  else if (input.pages.some((p) => p.qualityStatus)) add({ id: "line_weight", category: "Image resolution", status: "pass", title: "Line weight meets KDP's 0.75 pt minimum", detail: "Measured from the print-resolution artwork (median stroke width)." });
  const edgeWarn = input.pages.filter((p) => p.qualityMessages.some((m) => /cut off/i.test(m))).map((p) => p.position);
  if (edgeWarn.length) add({ id: "artwork_edges", category: "Image clipping", status: "warning", title: "Artwork may be cut off inside the image", detail: `Content pages ${list(edgeWarn)} have art touching the image edges.`, fix: "Review these pages and regenerate if the subject is cropped.", pages: edgeWarn });

  // Missing / duplicate / blank pages -------------------------------------------------
  const missing = interior.pages.filter((p) => p.missingImage).map((p) => p.number);
  if (missing.length) add({ id: "missing_pages", category: "Missing or duplicate pages", status: "error", title: "Pages without artwork", detail: `Interior pages ${list(missing)} have no illustration.`, fix: "Generate or upload artwork for every page, or delete empty pages.", pages: missing });
  else add({ id: "missing_pages", category: "Missing or duplicate pages", status: "pass", title: "Every content page has artwork", detail: `${plan.contentCount} content pages.` });
  const byHash = new Map<string, number[]>();
  for (const p of input.pages) if (p.sha256) byHash.set(p.sha256, [...(byHash.get(p.sha256) ?? []), p.position]);
  const dupes = [...byHash.values()].filter((v) => v.length > 1);
  if (dupes.length) add({ id: "duplicate_pages", category: "Missing or duplicate pages", status: "warning", title: "Duplicate illustrations", detail: dupes.map((d) => `content pages ${d.join(" & ")}`).join("; "), fix: "Regenerate or delete duplicates unless they are intentional.", pages: dupes.flat() });
  else add({ id: "duplicate_pages", category: "Missing or duplicate pages", status: "pass", title: "No duplicate illustrations", detail: "Every illustration is unique." });
  const blankArt = input.pages.filter((p) => p.qualityStatus === "error").map((p) => p.position);
  if (blankArt.length) add({ id: "blank_art", category: "Blank pages", status: "error", title: "Illustrations that are almost blank", detail: `Content pages ${list(blankArt)}.`, fix: "Regenerate these pages.", pages: blankArt });
  let run = 0;
  let maxRun = 0;
  for (const p of interior.pages) {
    run = p.kind === "blank" ? run + 1 : 0;
    maxRun = Math.max(maxRun, run);
  }
  const intentional = interior.pages.filter((p) => p.kind === "blank").length;
  if (maxRun > 2) add({ id: "blank_pages", category: "Blank pages", status: "warning", title: "More than two blank pages in a row", detail: `${maxRun} consecutive blank pages.`, fix: "Remove extra blank pages; KDP may flag long runs of blank pages." });
  else add({ id: "blank_pages", category: "Blank pages", status: intentional ? "manual" : "pass", title: intentional ? "Intentional blank pages" : "No blank pages", detail: intentional ? `${intentional} blank page(s): backs of single-sided coloring pages and padding to an even count. this is common for coloring books, but KDP lists 'excessive blank pages' among reasons files fail, so check the Print Previewer.` : "Every page has content." });

  // Fonts & text ---------------------------------------------------------------------
  const notEmbedded = [...interiorPdf.fonts, ...coverPdf.fonts].filter((f) => !f.embedded);
  if (notEmbedded.length) add({ id: "fonts_embedded", category: "Fonts & text", status: "error", title: "Fonts not embedded", detail: notEmbedded.map((f) => f.name).join(", "), fix: "Re-run the export." });
  else add({ id: "fonts_embedded", category: "Fonts & text", status: "pass", title: "All fonts embedded", detail: `${new Set([...interiorPdf.fonts, ...coverPdf.fonts].map((f) => f.name.replace(/^[A-Z]{6}\+/, ""))).size} font(s), all embedded (Fredoka and Nunito, SIL Open Font License).` });
  const overflow = interior.pages.filter((p) => p.textOverflow).map((p) => p.number);
  if (overflow.length) add({ id: "text_overflow", category: "Fonts & text", status: "error", title: "Text does not fit its box", detail: `Interior pages ${list(overflow)}.`, fix: "Shorten the story text on these pages.", pages: overflow });
  else add({ id: "text_overflow", category: "Fonts & text", status: "pass", title: "No text overflow", detail: "All text fits at a readable size." });
  const coverOverflow = cover.elements.filter((e) => e.overflow);
  if (coverOverflow.length) add({ id: "cover_text_overflow", category: "Fonts & text", status: "error", title: "Cover text does not fit", detail: coverOverflow.map((e) => e.kind.replace("_", " ")).join(", "), fix: "Shorten the title, subtitle or back-cover text." });

  // Cover dimensions & spine -------------------------------------------------------------
  const expectedSpine = spineWidth(pageCount, settings.paper);
  if (!near(L.spineWidth, expectedSpine, 0.0001) || L.pageCount !== pageCount)
    add({ id: "spine", category: "Cover & spine", status: "error", title: "Spine width is out of date", detail: `Cover uses ${L.spineWidth}" for ${L.pageCount} pages; the interior has ${pageCount} pages (${expectedSpine}").`, fix: "Re-run the export so the cover is recalculated." });
  else add({ id: "spine", category: "Cover & spine", status: "pass", title: "Spine width matches the final page count", detail: `${pageCount} pages × ${paper.spinePerPage}" (${paper.label.toLowerCase()}) = ${expectedSpine}".` });
  const coverSize = coverPdf.pageSizes[0];
  if (coverSize && (!near(coverSize.width, L.width) || !near(coverSize.height, L.height)))
    add({ id: "cover_dimensions", category: "Cover & spine", status: "error", title: "Cover PDF has the wrong size", detail: `${coverSize.width}" × ${coverSize.height}" instead of ${L.width}" × ${L.height}".`, fix: "Re-run the export." });
  else if (coverSize) add({ id: "cover_dimensions", category: "Cover & spine", status: "pass", title: "Cover size matches KDP's formula", detail: `${L.width}" × ${L.height}" = bleed + back + spine + front + bleed (0.125" bleed on every edge).` });
  const spineEl = cover.elements.find((e) => e.kind === "spine_text");
  if (spineEl && !L.spineTextAllowed) add({ id: "spine_text", category: "Cover & spine", status: "error", title: "Spine text where KDP doesn't allow it", detail: L.spineTextBlockedReason === "narrow" ? "The spine is too narrow for 7 pt text with 0.0625\" clearance on each side." : "KDP only prints spine text on books with enough pages (this app requires 80).", fix: "Turn off spine text." });
  else if (spineEl && L.spineSafe && !rectContains(L.spineSafe, spineEl.rect, 0.01)) add({ id: "spine_text", category: "Cover & spine", status: "error", title: "Spine text too close to the folds", detail: "Spine text must stay 0.0625\" from each spine edge.", fix: "Shorten the title or turn off spine text." });
  else add({ id: "spine_text", category: "Cover & spine", status: "pass", title: spineEl ? "Spine text placed safely" : "No spine text", detail: spineEl ? "At least 7 pt and 0.0625\" from both folds." : L.spineTextAllowed ? "Spine text is turned off." : L.spineTextBlockedReason === "narrow" ? `The spine (${L.spineWidth}") is too narrow for readable 7 pt text, so none is printed. Add pages for spine text.` : `Books under 80 pages can't carry spine text (this one has ${pageCount}).` });
  const zoneSafe: Record<string, Rect> = {
    front: { x: L.front.x + COVER_TEXT_MIN_INSET, y: L.front.y + COVER_TEXT_MIN_INSET, width: L.front.width - 2 * COVER_TEXT_MIN_INSET, height: L.front.height - 2 * COVER_TEXT_MIN_INSET },
    back: { x: L.back.x + COVER_TEXT_MIN_INSET, y: L.back.y + COVER_TEXT_MIN_INSET, width: L.back.width - 2 * COVER_TEXT_MIN_INSET, height: L.back.height - 2 * COVER_TEXT_MIN_INSET },
  };
  const unsafe = cover.elements.filter((e) => e.zone !== "spine" && e.kind !== "barcode_box" && !rectContains(zoneSafe[e.zone]!, e.rect, 0.01));
  if (unsafe.length) add({ id: "cover_safe_area", category: "Cover & spine", status: "error", title: "Cover text outside the safe area", detail: unsafe.map((e) => `${e.zone} ${e.kind.replace("_", " ")}`).join(", "), fix: "Move text at least 0.125\" inside the trim." });
  else add({ id: "cover_safe_area", category: "Cover & spine", status: "pass", title: "Cover text inside the safe area", detail: "All cover text is at least 0.25\" inside the trim lines and clear of the spine." });
  if (!input.hasCoverArt) add({ id: "cover_art", category: "Cover & spine", status: "warning", title: "No front-cover artwork", detail: "The cover uses a plain background.", fix: "Generate or upload cover art in the Cover Studio." });
  else if (cover.art && cover.art.dpi < MIN_ACCEPTABLE_DPI) add({ id: "cover_art", category: "Cover & spine", status: "warning", title: "Cover art below 200 DPI", detail: `${cover.art.dpi} DPI at print size.`, fix: "Upload higher-resolution cover art." });
  else if (cover.art) add({ id: "cover_art", category: "Cover & spine", status: cover.art.dpi < TARGET_DPI ? "warning" : "pass", title: cover.art.dpi < TARGET_DPI ? "Cover art below 300 DPI" : "Cover art resolution", detail: `${cover.art.dpi} DPI at print size.`, fix: cover.art.dpi < TARGET_DPI ? "Generate at high quality or upload larger art." : undefined });

  add({ id: "cover_color_mode", category: "Cover & spine", status: "manual", title: "Cover is RGB; KDP prints CMYK", detail: "KDP recommends CMYK cover files and converts RGB on upload, which can shift saturated colors slightly.", fix: "Check the cover colors in the KDP Print Previewer, or convert the cover to CMYK in a design tool." });

  // Barcode ---------------------------------------------------------------------------
  const barcodeClash = cover.elements.filter((e) => e.zone === "back" && e.kind !== "barcode_box" && rectsIntersect(e.rect, L.barcode));
  if (barcodeClash.length) add({ id: "barcode", category: "Barcode area", status: "error", title: "Content overlaps the barcode area", detail: barcodeClash.map((e) => e.kind.replace("_", " ")).join(", "), fix: "Shorten the back-cover text or hide thumbnails." });
  else add({ id: "barcode", category: "Barcode area", status: "pass", title: "Barcode area kept clear", detail: `A ${L.barcode.width}" × ${L.barcode.height}" area at the bottom right of the back cover is free for KDP's barcode.` });
  add({ id: "barcode_template", category: "Barcode area", status: "manual", title: "Compare with KDP's cover template", detail: "KDP's help pages don't publish the barcode box size; this app uses the size from KDP's downloadable cover template.", fix: "Download the template from KDP's cover calculator for your page count and compare." });

  // Content provenance & review ----------------------------------------------------------
  const demoPages = input.pages.filter((p) => p.isDemo).map((p) => p.position);
  if (demoPages.length || input.coverArtIsDemo)
    add({ id: "demo_content", category: "Content", status: "warning", title: "Demo placeholder artwork", detail: `${demoPages.length} page(s)${input.coverArtIsDemo ? " and the cover" : ""} use procedural DEMO art, not AI illustrations.`, fix: "Configure an image provider (OPENAI_API_KEY) and regenerate, or upload your own art before publishing.", pages: demoPages });
  const unapproved = input.pages.filter((p) => p.status !== "approved").map((p) => p.position);
  if (unapproved.length) add({ id: "approval", category: "Content", status: "warning", title: "Pages not approved", detail: `Content pages ${list(unapproved)} haven't been reviewed and approved.`, fix: "Review each page in the Page Studio and approve it." });
  else add({ id: "approval", category: "Content", status: "pass", title: "All pages approved", detail: "Every content page was reviewed and approved." });
  if (settings.mode !== "coloring") {
    const ordered = input.pages.filter((p) => p.storyIndex !== null);
    const outOfOrder = ordered.some((p, i) => i > 0 && p.storyIndex! < ordered[i - 1]!.storyIndex!);
    add(outOfOrder
      ? { id: "story_sequence", category: "Content", status: "warning", title: "Story pages are out of order", detail: "Pages were reordered so the story no longer reads in its original sequence.", fix: "Use 'Restore story order' in the Page Studio, or edit the text to match the new order." }
      : { id: "story_sequence", category: "Content", status: "pass", title: "Story reads in order", detail: "Pages follow the planned narrative." });
  }
  const md = input.metadata;
  if (md.description && PROHIBITED_LISTING.test(md.description)) add({ id: "listing_terms", category: "Listing", status: "warning", title: "Description contains terms KDP may reject", detail: "URLs, review requests, pricing or ranking claims were found.", fix: "Edit the description in the Export workspace." });
  add({ id: "ai_disclosure", category: "Listing", status: "manual", title: "Disclose AI-generated content", detail: "KDP asks whether a book contains AI-generated text or images during upload.", fix: "Answer KDP's AI-content questions accurately when you publish." });
  add({ id: "print_previewer", category: "Final review", status: "manual", title: "Review in the KDP Print Previewer", detail: "Automated checks cannot guarantee KDP acceptance. KDP reviews every new book.", fix: "Upload both PDFs to KDP and inspect every page in the Print Previewer before publishing." });
  add({ id: "content_review", category: "Final review", status: "manual", title: "Check every illustration by eye", detail: "Automated checks can't detect stray text, logos, watermarks or anatomical errors inside AI images.", fix: "Zoom into each page in the Page Studio." });

  const summary = { pass: 0, warning: 0, error: 0, manual: 0 } as Record<CheckStatus, number>;
  for (const f of findings) summary[f.status]++;
  return {
    generatedAt: new Date().toISOString(),
    summary,
    ready: summary.error === 0,
    spec: { trim: settings.trimSize, paper: settings.paper, bleed: settings.bleed, interiorPages: pageCount, spineWidth: L.spineWidth, coverWidth: L.width, coverHeight: L.height },
    findings,
    limitations: [
      "This report checks files against KDP's published paperback specifications; it does not guarantee acceptance.",
      "Image checks are heuristics: they can't see text, logos or watermarks inside artwork.",
      "Maximum page counts vary by trim size and paper; confirm on KDP.",
    ],
  };
}
