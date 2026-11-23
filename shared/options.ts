/** Book configuration vocabularies shared by the wizard, the API and the AI prompt builder. */

export type BookMode = "coloring" | "story_coloring" | "story";

export const BOOK_MODES: Array<{ id: BookMode; label: string; description: string }> = [
  { id: "coloring", label: "Coloring only", description: "One illustration per page, no story text." },
  { id: "story_coloring", label: "Story + coloring", description: "A short story told across the pages, each with a scene to color." },
  { id: "story", label: "Story only", description: "Text-led story pages with an optional spot illustration." },
];

export type AgeGroup = "toddler" | "preschool" | "kids" | "tween" | "teen" | "adult" | "senior";

export interface AgeGroupSpec {
  id: AgeGroup;
  label: string;
  /** Default complexity for this audience. */
  complexity: Complexity;
  /** Plain-language reading level for story text. */
  readingLevel: string;
  maxWordsPerPage: number;
}

export const AGE_GROUPS: AgeGroupSpec[] = [
  { id: "toddler", label: "Toddlers (1–3)", complexity: "simple", readingLevel: "very short sentences, 3–8 words", maxWordsPerPage: 15 },
  { id: "preschool", label: "Preschool (3–5)", complexity: "simple", readingLevel: "short simple sentences", maxWordsPerPage: 30 },
  { id: "kids", label: "Kids (4–8)", complexity: "medium", readingLevel: "early reader, short paragraphs", maxWordsPerPage: 50 },
  { id: "tween", label: "Tweens (8–12)", complexity: "medium", readingLevel: "middle grade", maxWordsPerPage: 80 },
  { id: "teen", label: "Teens (13+)", complexity: "detailed", readingLevel: "young adult", maxWordsPerPage: 90 },
  { id: "adult", label: "Adults", complexity: "detailed", readingLevel: "adult", maxWordsPerPage: 90 },
  { id: "senior", label: "Seniors (large & easy)", complexity: "simple", readingLevel: "clear, large print", maxWordsPerPage: 40 },
];

export type Complexity = "simple" | "medium" | "detailed";

export const COMPLEXITY_RULES: Record<Complexity, { label: string; lineWeight: string; regions: string; detail: string }> = {
  simple: {
    label: "Simple",
    lineWeight: "very thick, bold, uniform outlines",
    regions: "very large, open coloring regions that small hands can fill",
    detail: "one main subject, minimal or no background, no tiny details",
  },
  medium: {
    label: "Medium",
    lineWeight: "bold, clean outlines of consistent weight",
    regions: "medium-sized closed regions",
    detail: "a main subject with a light, uncluttered background",
  },
  detailed: {
    label: "Detailed",
    lineWeight: "fine, crisp, confident outlines",
    regions: "many smaller closed regions for careful coloring",
    detail: "rich but organised detail and patterns, still uncluttered",
  },
};

export interface ArtStyle {
  id: string;
  label: string;
  description: string;
  /** Stable style phrase repeated in every illustration prompt for consistency. */
  prompt: string;
}

export const ART_STYLES: ArtStyle[] = [
  { id: "bold_easy", label: "Bold & Easy", description: "Thick outlines and big shapes for little hands and seniors.", prompt: "bold and easy coloring page style, thick rounded outlines, big simple shapes" },
  { id: "kids_cartoon", label: "Kids Cartoon", description: "Friendly cartoon characters with expressive faces.", prompt: "friendly children's cartoon coloring book style, expressive cute characters" },
  { id: "storybook", label: "Storybook Line Art", description: "Gentle picture-book line drawings with scenery.", prompt: "gentle picture-book line illustration style with simple scenery" },
  { id: "cozy", label: "Cozy Scenes", description: "Warm interiors, cottages and calm everyday moments.", prompt: "cozy hygge coloring book style, warm homely scenes, soft rounded shapes" },
  { id: "kawaii", label: "Kawaii", description: "Super-cute rounded characters with big eyes.", prompt: "kawaii chibi coloring style, round cute characters with big eyes" },
  { id: "mandala", label: "Mandala & Patterns", description: "Symmetric, meditative patterns.", prompt: "symmetric mandala-inspired pattern coloring style, decorative ornaments" },
  { id: "stained_glass", label: "Stained Glass", description: "Leaded-glass segments with clear divisions.", prompt: "stained glass coloring style, subject divided into clean leaded segments" },
  { id: "detailed", label: "Detailed & Realistic", description: "Fine linework and realistic proportions for adults.", prompt: "detailed realistic pen-and-ink coloring page style, accurate proportions" },
];

export function getArtStyle(id: string): ArtStyle {
  return ART_STYLES.find((s) => s.id === id) ?? ART_STYLES[1]!;
}

export const BOOK_CATEGORIES = [
  "Animals",
  "Dinosaurs",
  "Ocean & Sea Life",
  "Fantasy & Fairy Tales",
  "Vehicles",
  "Space",
  "Nature & Gardens",
  "Holidays & Seasons",
  "Food & Treats",
  "Educational (ABC & 123)",
  "Mandalas & Patterns",
  "Cozy & Lifestyle",
  "Sports",
  "Other",
] as const;

/** Languages KDP supports for paperback interiors that this app can write in. */
export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "nl", label: "Dutch" },
] as const;

export const TONES = ["playful", "calm", "adventurous", "funny", "cozy", "educational", "inspiring"] as const;

export function getAgeGroup(id: string): AgeGroupSpec {
  return AGE_GROUPS.find((a) => a.id === id) ?? AGE_GROUPS[2]!;
}

export function languageLabel(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.label ?? "English";
}
