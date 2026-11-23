import { z } from "zod";
import { getAgeGroup } from "../../shared/options.ts";
import type { BookSettings } from "../../shared/settings.ts";

/**
 * Schemas sent to the text model as structured-output formats. They stay
 * simple (no length constraints) because structured outputs support a subset
 * of JSON Schema; stricter rules are enforced locally by validatePlan().
 */
export const characterSchema = z.object({
  key: z.string().describe("lowercase snake_case id, e.g. milo_rabbit"),
  name: z.string(),
  role: z.string().describe("e.g. main character, best friend"),
  description: z.string().describe("personality and story role, one or two sentences"),
  visual_traits: z.string().describe("fixed visual description repeated in every illustration prompt: species, body shape, clothing, distinctive features; no colors"),
});

export const plannedPageSchema = z.object({
  page_number: z.number().int(),
  scene_title: z.string(),
  story_text: z.string().describe("text printed on the page; empty string for coloring-only books"),
  scene_description: z.string().describe("what the illustration shows, for the illustrator; never asks for text inside the picture"),
  characters: z.array(z.string()).describe("character keys that appear in the scene"),
  activity: z.string().describe("optional short coloring tip or activity prompt; empty string if none"),
});

export const bookPlanSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  synopsis: z.string(),
  tone: z.string(),
  outline: z.array(z.string()),
  characters: z.array(characterSchema),
  pages: z.array(plannedPageSchema),
});

export type BookPlan = z.infer<typeof bookPlanSchema>;
export type PlannedPage = z.infer<typeof plannedPageSchema>;
export type PlannedCharacter = z.infer<typeof characterSchema>;

export const regeneratedPagesSchema = z.object({ pages: z.array(plannedPageSchema) });

export const metadataDraftSchema = z.object({
  title_suggestions: z.array(z.string()),
  subtitle_suggestions: z.array(z.string()),
  description: z.string().describe("Amazon book description, plain text paragraphs, no URLs, no reviews or sales claims"),
  age_range: z.string(),
  categories: z.array(z.string()),
  keywords: z.array(z.string()).describe("exactly 7 keyword phrases for the KDP keyword slots"),
  keyword_candidates: z.array(z.string()).describe("up to 20 ranked keyword ideas"),
  copyright_text: z.string(),
});

export type MetadataDraft = z.infer<typeof metadataDraftSchema>;

export interface PlanIssue {
  severity: "info" | "warning" | "error";
  message: string;
  page?: number;
}

const UNSAFE_FOR_CHILDREN = /\b(blood|bloody|kill|killed|killing|gun|guns|weapon|murder|dead body|knife|knives|gore|horror|terrifying|scary monster|beer|wine|cigarette)\b/i;
const TEXT_IN_IMAGE = /\b(sign (that )?(says|reads)|banner (that )?(says|reads)|written|writing|letters spelling|the words?|caption|speech bubble|label(l)?ed)\b/i;
const CHILD_AUDIENCES = new Set(["toddler", "preschool", "kids", "tween"]);

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
}

export function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function slugKey(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "character";
}

/**
 * Validates and normalizes a generated plan before anything is stored.
 * Hard failures throw; recoverable problems are fixed and reported as issues.
 */
export function validatePlan(raw: unknown, settings: BookSettings): { plan: BookPlan; issues: PlanIssue[] } {
  const parsed = bookPlanSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`The generated plan did not match the expected structure: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  const plan = structuredClone(parsed.data);
  const issues: PlanIssue[] = [];
  const target = settings.illustrationCount;
  if (plan.pages.length < target) throw new Error(`The generated plan has ${plan.pages.length} pages but ${target} were requested.`);
  if (plan.pages.length > target) {
    issues.push({ severity: "info", message: `Trimmed ${plan.pages.length - target} extra planned pages.` });
    plan.pages = plan.pages.slice(0, target);
  }
  if (!plan.title.trim()) throw new Error("The generated plan has no title.");

  // Characters: unique, slugged keys.
  const seen = new Set<string>();
  plan.characters = plan.characters
    .map((c) => ({ ...c, key: slugKey(c.key || c.name), name: c.name.trim(), visual_traits: c.visual_traits.trim() }))
    .filter((c) => {
      if (!c.name || seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    })
    .slice(0, 12);
  for (const c of plan.characters) if (c.visual_traits.length < 12) issues.push({ severity: "warning", message: `Character "${c.name}" has a very short visual description; consistency may suffer.` });

  const age = getAgeGroup(settings.audience);
  const story = settings.mode !== "coloring";
  plan.pages.forEach((p, i) => {
    p.page_number = i + 1;
    p.scene_title = p.scene_title.trim() || `Scene ${i + 1}`;
    p.scene_description = p.scene_description.trim();
    if (!p.scene_description) throw new Error(`Planned page ${i + 1} has no scene description.`);
    const unknown = p.characters.filter((k) => !seen.has(slugKey(k)));
    p.characters = p.characters.map(slugKey).filter((k) => seen.has(k));
    if (unknown.length) issues.push({ severity: "info", page: i + 1, message: `Removed unknown character reference(s): ${unknown.join(", ")}.` });
    if (!story) p.story_text = "";
    if (story && !p.story_text.trim()) issues.push({ severity: "warning", page: i + 1, message: "Story page has no text." });
    const wordCount = p.story_text.trim() ? p.story_text.trim().split(/\s+/).length : 0;
    if (wordCount > age.maxWordsPerPage * 1.5) issues.push({ severity: "warning", page: i + 1, message: `Story text is long for this age group (${wordCount} words; aim for ≤ ${age.maxWordsPerPage}).` });
    if (CHILD_AUDIENCES.has(settings.audience) && (UNSAFE_FOR_CHILDREN.test(p.story_text) || UNSAFE_FOR_CHILDREN.test(p.scene_description)))
      issues.push({ severity: "error", page: i + 1, message: "Content may not be appropriate for the selected age group. Review or regenerate this page." });
    if (TEXT_IN_IMAGE.test(p.scene_description)) issues.push({ severity: "warning", page: i + 1, message: "Scene asks for written text inside the illustration; image models render text poorly. Consider rewording." });
  });
  for (let i = 0; i < plan.pages.length; i++) {
    for (let j = i + 1; j < plan.pages.length; j++) {
      const a = plan.pages[i]!;
      const b = plan.pages[j]!;
      if (a.scene_title.toLowerCase() === b.scene_title.toLowerCase() || similarity(a.scene_description, b.scene_description) > 0.75)
        issues.push({ severity: "warning", page: j + 1, message: `Scene looks very similar to page ${i + 1}. Consider regenerating it for variety.` });
    }
  }
  return { plan, issues };
}
