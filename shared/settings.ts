import { z } from "zod";
import { isValidTrimId, type PaperType } from "./kdp.ts";
import { AGE_GROUPS, ART_STYLES, LANGUAGES, type AgeGroup, type BookMode, type Complexity } from "./options.ts";

/** Book configuration chosen in the create-book wizard and the settings panel. */
export const bookSettingsSchema = z.object({
  theme: z.string().trim().min(3, "Describe the theme in a few words.").max(600),
  audience: z.enum(AGE_GROUPS.map((a) => a.id) as [AgeGroup, ...AgeGroup[]]),
  language: z.enum(LANGUAGES.map((l) => l.id) as [string, ...string[]]),
  category: z.string().trim().min(1).max(60),
  artStyle: z.enum(ART_STYLES.map((s) => s.id) as [string, ...string[]]),
  complexity: z.enum(["simple", "medium", "detailed"] satisfies Complexity[]),
  mode: z.enum(["coloring", "story_coloring", "story"] satisfies BookMode[]),
  tone: z.string().trim().max(40).default("playful"),
  objective: z.string().trim().max(300).default(""),
  mainCharacters: z.string().trim().max(1000).default(""),
  trimSize: z.string().refine(isValidTrimId, "Choose a KDP trim size, or a custom size between 4×6 and 8.5×11.69 inches."),
  paper: z.enum(["white", "cream", "standard_color", "premium_color"] satisfies PaperType[]),
  bleed: z.boolean(),
  /** Number of illustrated content pages (front matter and blank backs are added at layout time). */
  illustrationCount: z.number().int().min(1).max(200),
  /** Print each coloring page on its own sheet with a blank back to prevent bleed-through. */
  blankBacks: z.boolean(),
  frontMatter: z.object({
    titlePage: z.boolean(),
    copyrightPage: z.boolean(),
    belongsTo: z.boolean(),
    colorTestPage: z.boolean(),
    dedication: z.string().trim().max(400).default(""),
  }),
  margins: z.object({
    top: z.number().min(0.25).max(1.5),
    bottom: z.number().min(0.25).max(1.5),
    outside: z.number().min(0.25).max(1.5),
    inside: z.number().min(0.25).max(1.5),
  }),
  cover: z.object({
    mood: z.string().trim().max(120).default("bright and cheerful"),
    colorScheme: z.string().trim().max(120).default(""),
    notes: z.string().trim().max(400).default(""),
  }),
  generation: z.object({
    /** Convert generated art to pure black-and-white line art (removes gray shading). */
    cleanLineArt: z.boolean(),
    /** Send approved character reference images to providers that support image conditioning. */
    useCharacterReferences: z.boolean(),
    quality: z.enum(["draft", "standard", "high"]),
  }),
});

export type BookSettings = z.infer<typeof bookSettingsSchema>;

export function defaultSettings(overrides: Partial<BookSettings> = {}): BookSettings {
  return bookSettingsSchema.parse({
    theme: "Friendly dinosaurs having a picnic",
    audience: "kids",
    language: "en",
    category: "Dinosaurs",
    artStyle: "kids_cartoon",
    complexity: "medium",
    mode: "coloring",
    tone: "playful",
    objective: "",
    mainCharacters: "",
    trimSize: "8.5x11",
    paper: "white",
    bleed: false,
    illustrationCount: 12,
    blankBacks: true,
    frontMatter: { titlePage: true, copyrightPage: true, belongsTo: true, colorTestPage: false, dedication: "" },
    margins: { top: 0.5, bottom: 0.5, outside: 0.5, inside: 0.5 },
    cover: { mood: "bright and cheerful", colorScheme: "", notes: "" },
    generation: { cleanLineArt: true, useCharacterReferences: true, quality: "standard" },
    ...overrides,
  });
}

export const coverConfigSchema = z.object({
  title: z.string().trim().max(200).default(""),
  subtitle: z.string().trim().max(300).default(""),
  author: z.string().trim().max(150).default(""),
  backText: z.string().trim().max(1500).default(""),
  titleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1d1640"),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#fff6e0"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff7a59"),
  titlePosition: z.enum(["top", "bottom"]).default("top"),
  titleScale: z.number().min(0.6).max(1.5).default(1),
  showThumbnails: z.boolean().default(true),
  reserveBarcode: z.boolean().default(true),
  spineText: z.boolean().default(true),
  artPrompt: z.string().trim().max(1000).default(""),
});

export type CoverConfig = z.infer<typeof coverConfigSchema>;

export const metadataSchema = z.object({
  title: z.string().trim().max(200).default(""),
  subtitle: z.string().trim().max(200).default(""),
  titleSuggestions: z.array(z.string().max(200)).max(10).default([]),
  subtitleSuggestions: z.array(z.string().max(200)).max(10).default([]),
  description: z.string().max(4000).default(""),
  ageRange: z.string().max(40).default(""),
  categories: z.array(z.string().max(200)).max(10).default([]),
  keywords: z.array(z.string().max(50)).max(7).default([]),
  keywordCandidates: z.array(z.string().max(50)).max(30).default([]),
  authorName: z.string().max(150).default(""),
  copyrightText: z.string().max(2000).default(""),
  aiDisclosure: z.string().max(500).default(""),
  checklist: z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean() })).default([]),
});

export type BookMetadata = z.infer<typeof metadataSchema>;

export type PageStatus = "planned" | "queued" | "generating" | "generated" | "needs_review" | "approved" | "rejected" | "failed";

export type ProjectStatus = "draft" | "planning" | "planned" | "illustrating" | "review" | "exported";

export type ExportStatus = "queued" | "building" | "blocked" | "ready_for_review" | "failed";

export type CheckStatus = "pass" | "warning" | "error" | "manual";

export interface ValidationFinding {
  id: string;
  category: string;
  status: CheckStatus;
  title: string;
  detail: string;
  fix?: string;
  pages?: number[];
}

export interface ValidationReport {
  generatedAt: string;
  summary: { pass: number; warning: number; error: number; manual: number };
  ready: boolean;
  spec: {
    trim: string;
    paper: string;
    bleed: boolean;
    interiorPages: number;
    spineWidth: number;
    coverWidth: number;
    coverHeight: number;
  };
  findings: ValidationFinding[];
  limitations: string[];
}
