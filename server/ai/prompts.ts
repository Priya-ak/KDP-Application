import { COMPLEXITY_RULES, getAgeGroup, getArtStyle, languageLabel } from "../../shared/options.ts";
import type { BookSettings } from "../../shared/settings.ts";

export interface PromptCharacter {
  key: string;
  name: string;
  visual_traits: string;
}

/** System prompt for book planning. Stable text (cache-friendly); per-book details go in the user turn. */
export const PLANNER_SYSTEM = `You plan printable coloring books and illustrated story-coloring books for self-publishers.
You write the concept, a character bible and a page-by-page plan that an illustrator will turn into black-and-white line art.

Principles:
- Every page shows a different, concrete, drawable scene. Vary settings, actions and composition; never repeat a scene.
- Scenes must be simple enough to read as clean line art at the requested complexity. One clear focal subject per page.
- Never ask for written words, signs, labels, numbers or speech bubbles inside an illustration.
- Keep every character's visual traits identical across the book; describe them once in the character bible (shape, clothing, distinctive features, no colors, since the art is black and white).
- Content must suit the stated audience: gentle, kind and age-appropriate for children; no violence, weapons, frightening imagery, brands or real people.
- Do not imitate or name existing copyrighted characters, franchises or living artists.
- Write story text in the requested language at the requested reading level. Keep each page's text short enough for its page.`;

export function planUserPrompt(settings: BookSettings, extra = ""): string {
  const age = getAgeGroup(settings.audience);
  const style = getArtStyle(settings.artStyle);
  const story = settings.mode !== "coloring";
  return [
    `Plan a ${settings.mode === "coloring" ? "coloring book" : settings.mode === "story" ? "story book" : "story-plus-coloring book"}.`,
    `Theme / concept: ${settings.theme}`,
    `Audience: ${age.label}. Reading level: ${age.readingLevel}. At most ${age.maxWordsPerPage} words of story text per page.`,
    `Language for all text: ${languageLabel(settings.language)}.`,
    `Category: ${settings.category}. Tone: ${settings.tone}.`,
    settings.objective ? `Objective: ${settings.objective}` : "",
    settings.mainCharacters ? `Characters the author wants: ${settings.mainCharacters}` : "Invent 1-3 recurring characters if they suit the theme (a pattern or mandala book may have none).",
    `Art style: ${style.label} (${style.description}). Complexity: ${COMPLEXITY_RULES[settings.complexity].label}.`,
    `Exactly ${settings.illustrationCount} pages, numbered 1 to ${settings.illustrationCount}.`,
    story ? "Each page carries one beat of a single coherent story with a beginning, middle and satisfying end." : "This is coloring only: story_text must be an empty string on every page. Order scenes to feel like a pleasant journey through the theme.",
    "Give the book an original title and subtitle suitable for an Amazon listing.",
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Deterministic illustration prompt: the same style phrase, line-art rules and
 * character descriptions are repeated verbatim on every page so the image model
 * sees a stable description of each character and the book's look.
 */
export function buildIllustrationPrompt(page: { scene_description: string; characters: string[] }, characters: PromptCharacter[], settings: BookSettings): string {
  const age = getAgeGroup(settings.audience);
  const style = getArtStyle(settings.artStyle);
  const rules = COMPLEXITY_RULES[settings.complexity];
  const cast = page.characters
    .map((k) => characters.find((c) => c.key === k))
    .filter((c): c is PromptCharacter => !!c)
    .map((c) => `${c.name}: ${c.visual_traits}`);
  return [
    `Black-and-white coloring book page for ${age.label.toLowerCase()}, ${style.prompt}.`,
    `Scene: ${page.scene_description}`,
    cast.length ? `Characters (draw each exactly as described, same design on every page): ${cast.join("; ")}.` : "",
    `Line art: ${rules.lineWeight}; ${rules.regions}; ${rules.detail}.`,
    "Pure black outlines on a plain white background, closed shapes, no shading, no gray tones, no hatching, no solid black fills.",
    "Portrait composition with the whole subject fully visible and a comfortable white margin on every side.",
    "No text, letters, numbers, signatures, logos, frames or watermarks.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildCoverPrompt(settings: BookSettings, characters: PromptCharacter[], custom = ""): string {
  const cast = characters.slice(0, 3).map((c) => `${c.name} (${c.visual_traits})`);
  return [
    `Full-color front cover illustration for a ${settings.mode === "coloring" ? "coloring book" : "children's story and coloring book"} about: ${settings.theme}.`,
    `Mood: ${settings.cover.mood || "bright and cheerful"}.`,
    settings.cover.colorScheme ? `Color scheme: ${settings.cover.colorScheme}.` : "",
    cast.length ? `Feature: ${cast.join("; ")}.` : "",
    custom || settings.cover.notes,
    "Keep the upper third calm and uncluttered because the title will be typeset there separately.",
    "Absolutely no text, letters, title, numbers, logos or watermarks in the image.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildCharacterPrompt(character: PromptCharacter & { description?: string }, settings: BookSettings): string {
  const style = getArtStyle(settings.artStyle);
  return `Character reference sheet in black-and-white coloring line art, ${style.prompt}. ${character.name}: ${character.visual_traits}. Full body, front view, centered, neutral pose, plain white background, no shading, no text or labels.`;
}

export const METADATA_SYSTEM = `You write Amazon KDP listing metadata for coloring and activity books.
Be accurate to the book's actual content. Never include URLs, email addresses, review requests, prices, time-sensitive promotions, claims like "bestseller" or "#1", competitor names, or trademarked character names.
Keywords are short search phrases a shopper would type; do not repeat words from the title; no quotation marks.
The copyright text is a short copyright-page draft with an "All rights reserved" notice and a placeholder year and author.`;
