import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AppConfig } from "../config.ts";
import { JobError, kindForStatus, parseRetryAfter } from "../errors.ts";
import { getAgeGroup, languageLabel } from "../../shared/options.ts";
import type { BookSettings } from "../../shared/settings.ts";
import { bookPlanSchema, metadataDraftSchema, regeneratedPagesSchema, slugKey, type BookPlan, type MetadataDraft, type PlannedPage } from "./schemas.ts";
import { METADATA_SYSTEM, PLANNER_SYSTEM, planUserPrompt } from "./prompts.ts";

export interface TextUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextResult<T> {
  data: T;
  usage: TextUsage;
  provider: string;
  model: string;
}

export interface RegenerateInput {
  settings: BookSettings;
  plan: Pick<BookPlan, "title" | "synopsis" | "characters">;
  pages: PlannedPage[];
  /** Page numbers to rewrite. */
  targets: number[];
  instructions: string;
}

export interface MetadataInput {
  settings: BookSettings;
  title: string;
  subtitle: string;
  synopsis: string;
  sceneTitles: string[];
  author: string;
  interiorPages: number;
}

export interface TextProvider {
  readonly name: string;
  readonly model: string;
  readonly isDemo: boolean;
  planBook(settings: BookSettings, extra?: string): Promise<TextResult<BookPlan>>;
  regeneratePages(input: RegenerateInput): Promise<TextResult<{ pages: PlannedPage[] }>>;
  generateMetadata(input: MetadataInput): Promise<TextResult<MetadataDraft>>;
}

// ---------------------------------------------------------------------------
// Anthropic (Claude) provider: structured outputs validated against Zod schemas.

/** Shared prompts for every real LLM provider; subclasses only implement the structured call. */
abstract class LlmTextProvider implements TextProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  readonly isDemo = false;

  protected abstract call<S extends z.ZodType>(system: string, user: string, schema: S): Promise<TextResult<z.infer<S>>>;
  planBook(settings: BookSettings, extra = "") {
    return this.call(PLANNER_SYSTEM, planUserPrompt(settings, extra), bookPlanSchema);
  }

  regeneratePages(input: RegenerateInput) {
    const user = [
      planUserPrompt(input.settings),
      `\nExisting book: "${input.plan.title}". Synopsis: ${input.plan.synopsis}`,
      `Character bible (keep these keys and descriptions): ${JSON.stringify(input.plan.characters)}`,
      `Current pages: ${JSON.stringify(input.pages.map((p) => ({ page_number: p.page_number, scene_title: p.scene_title, story_text: p.story_text, scene_description: p.scene_description })))}`,
      `Rewrite ONLY pages ${input.targets.join(", ")} so they stay consistent with the surrounding pages. Return just those pages with their original page_number.`,
      input.instructions ? `Author's instructions: ${input.instructions}` : "",
    ].join("\n");
    return this.call(PLANNER_SYSTEM, user, regeneratedPagesSchema);
  }

  generateMetadata(input: MetadataInput) {
    const user = [
      `Book: "${input.title}"${input.subtitle ? ` — ${input.subtitle}` : ""} by ${input.author || "the author"}.`,
      `Type: ${input.settings.mode === "coloring" ? "coloring book" : "story and coloring book"}, ${input.interiorPages} interior pages, ${input.settings.trimSize} inch paperback.`,
      `Audience: ${getAgeGroup(input.settings.audience).label}. Language: ${languageLabel(input.settings.language)}. Category: ${input.settings.category}.`,
      `Synopsis: ${input.synopsis}`,
      `Scenes: ${input.sceneTitles.join("; ")}`,
      "Write the listing in the book's language.",
    ].join("\n");
    return this.call(METADATA_SYSTEM, user, metadataDraftSchema);
  }
}

export class AnthropicTextProvider extends LlmTextProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly config: AppConfig["ai"]) {
    super();
    this.client = new Anthropic({ timeout: config.textTimeoutMs, maxRetries: 2 });
  }

  get model() {
    return this.config.anthropicModel;
  }

  protected async call<S extends z.ZodType>(system: string, user: string, schema: S): Promise<TextResult<z.infer<S>>> {
    try {
      const res = await this.client.beta.messages.parse({
        model: this.config.anthropicModel,
        max_tokens: 16000,
        // Server-side fallback: if the primary model declines, the API retries on a fallback model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: betaZodOutputFormat(schema), effort: this.config.anthropicEffort },
      });
      if (res.stop_reason === "refusal") throw new JobError("content_policy", "The text model declined this request. Try rewording the theme.");
      if (res.stop_reason === "max_tokens") throw new JobError("permanent", "The generated plan was too long. Reduce the page count or regenerate in smaller sections.");
      if (!res.parsed_output) throw new JobError("transient", "The text model returned output that did not match the schema.");
      return { data: res.parsed_output as z.infer<S>, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }, provider: this.name, model: res.model };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Groq provider (free tier available). Groq's strict json_schema mode only works on some models, so this
// uses JSON mode with the schema in the prompt, validates locally with Zod, and retries once with the error.

export class GroqTextProvider extends LlmTextProvider {
  readonly name = "groq";

  constructor(private readonly config: AppConfig["ai"]) {
    super();
  }

  get model() {
    return this.config.groqModel;
  }

  private async request(messages: Array<{ role: string; content: string }>): Promise<{ content: string; usage: TextUsage; model: string; finish: string }> {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new JobError("config", "GROQ_API_KEY is not configured.");
    let res: Response;
    try {
      res = await fetch(`${this.config.groqBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.config.groqModel, messages, response_format: { type: "json_object" }, temperature: 0.7, max_tokens: this.config.groqMaxTokens }),
        signal: AbortSignal.timeout(this.config.textTimeoutMs),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new JobError("timeout", "Groq took too long to respond.");
      throw new JobError("transient", "Could not reach Groq.");
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = "";
      try {
        detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
      } catch {
        // non-JSON body
      }
      if (res.status === 413 || /request too large|tokens per minute|TPM/i.test(detail))
        throw new JobError(res.status === 413 ? "permanent" : "rate_limit", `Groq free-tier size or rate limit hit: ${detail.slice(0, 200)} Try fewer pages per run or a model with a larger limit.`, parseRetryAfter(res.headers.get("retry-after")) ?? 20_000);
      throw new JobError(kindForStatus(res.status), `Groq error (${res.status}): ${detail.slice(0, 250)}`, parseRetryAfter(res.headers.get("retry-after")));
    }
    const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
    const choice = body.choices?.[0];
    return { content: choice?.message?.content ?? "", finish: choice?.finish_reason ?? "", model: body.model ?? this.config.groqModel, usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 } };
  }

  protected async call<S extends z.ZodType>(system: string, user: string, schema: S): Promise<TextResult<z.infer<S>>> {
    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    const messages = [
      { role: "system", content: `${system}\n\nReply with a single JSON object and nothing else. It must validate against this JSON Schema:\n${jsonSchema}` },
      { role: "user", content: user },
    ];
    const usage: TextUsage = { inputTokens: 0, outputTokens: 0 };
    let lastProblem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.request(messages);
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      if (r.finish === "length") throw new JobError("permanent", "The generated plan was cut off. Reduce the page count or rewrite fewer pages at a time.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.content);
      } catch {
        lastProblem = "The reply was not valid JSON.";
        messages.push({ role: "assistant", content: r.content.slice(0, 4000) }, { role: "user", content: `${lastProblem} Reply again with only the JSON object.` });
        continue;
      }
      const checked = schema.safeParse(parsed);
      if (checked.success) return { data: checked.data as z.infer<S>, usage, provider: this.name, model: r.model };
      lastProblem = checked.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
      messages.push({ role: "assistant", content: r.content.slice(0, 4000) }, { role: "user", content: `That JSON did not match the schema (${lastProblem}). Reply again with the corrected JSON object only.` });
    }
    throw new JobError("transient", `Groq returned output that did not match the schema (${lastProblem}).`);
  }
}

function mapAnthropicError(err: unknown): JobError {
  if (err instanceof JobError) return err;
  if (err instanceof Anthropic.RateLimitError) return new JobError("rate_limit", "The text provider is rate limiting requests.", parseRetryAfter(err.headers?.get?.("retry-after")));
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new JobError("config", "The Anthropic API key is missing or invalid.");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new JobError("timeout", "The text provider timed out.");
  if (err instanceof Anthropic.APIConnectionError) return new JobError("transient", "Could not reach the text provider.");
  if (err instanceof Anthropic.InternalServerError) return new JobError("transient", "The text provider had a temporary error.");
  if (err instanceof Anthropic.BadRequestError) return new JobError("permanent", `The text provider rejected the request: ${err.message.slice(0, 300)}`);
  if (err instanceof Anthropic.APIError) return new JobError((err.status ?? 500) >= 500 ? "transient" : "permanent", `Text provider error (${err.status ?? "unknown"}).`);
  return new JobError("permanent", (err as Error)?.message?.slice(0, 500) ?? "Unknown text provider error");
}

// ---------------------------------------------------------------------------
// Demo provider: deterministic template writer used when no API key is set.
// Its output is marked provider = "demo" and shown as demo content in the UI.

const HERO_NAMES = ["Milo", "Luna", "Pip", "Rosie", "Ziggy", "Nova", "Benny", "Daisy", "Otto", "Juniper"];
const FRIEND_NAMES = ["Coco", "Biscuit", "Penny", "Toby", "Wren", "Maple"];
const SPECIES = ["dinosaur", "bunny", "kitten", "puppy", "bear", "fox", "owl", "turtle", "unicorn", "dragon", "whale", "penguin", "elephant", "robot", "mermaid", "lion", "panda", "cat", "dog", "fish", "astronaut", "monkey", "horse", "frog"];
const SCENES: Array<{ title: string; scene: string; story: string }> = [
  { title: "Good Morning", scene: "{hero} stretches beside a round window as the sun rises over gentle hills", story: "{hero} wakes up early. Today feels like a special day!" },
  { title: "Breakfast Time", scene: "{hero} sits at a small table with a bowl, a cup and a plate of fruit", story: "First, a big breakfast. {hero} shares the berries with {friend}." },
  { title: "The Garden Path", scene: "{hero} walks along a winding path lined with large flowers and a picket fence", story: "The garden path is full of flowers. {hero} counts them one by one." },
  { title: "Meeting a Friend", scene: "{hero} waves hello to {friend} next to a big leafy tree", story: "{friend} is waiting by the old tree. \"Let's go on an adventure!\"" },
  { title: "Over the Bridge", scene: "{hero} and {friend} cross a little wooden bridge over a calm stream with stepping stones", story: "They tiptoe over the little bridge. The stream goes splish, splash." },
  { title: "Butterfly Meadow", scene: "{hero} chases big butterflies through a meadow of tall grass and daisies", story: "Butterflies dance in the meadow. {hero} spins around and giggles." },
  { title: "Picnic Blanket", scene: "{hero} and {friend} unpack a picnic basket on a checkered blanket", story: "Time for a picnic! Sandwiches, apples and a big slice of cake." },
  { title: "Kite Flying", scene: "{hero} holds the string of a diamond-shaped kite high above fluffy clouds", story: "Whoosh! The kite flies up, up, up into the sky." },
  { title: "Rainy Puddles", scene: "{hero} in rain boots jumps into a puddle under an umbrella", story: "A little rain begins. {hero} jumps in every puddle. Splash!" },
  { title: "Rainbow Hill", scene: "{hero} stands on a hilltop looking at a big rainbow arching over the valley", story: "When the rain stops, a rainbow appears. It is beautiful." },
  { title: "Building a Fort", scene: "{hero} and {friend} build a fort from blankets, pillows and chairs", story: "Back home, they build the coziest fort ever." },
  { title: "Baking Cookies", scene: "{hero} wears an apron and rolls cookie dough on a kitchen counter with bowls and spoons", story: "{hero} bakes star-shaped cookies for everyone." },
  { title: "Music Time", scene: "{hero} plays a drum while {friend} shakes maracas", story: "Boom, boom, shake! They make happy music together." },
  { title: "Reading Nook", scene: "{hero} reads a big book in a comfy armchair with a lamp and a cat-shaped pillow", story: "Quiet time. {hero} reads a story about the sea." },
  { title: "Beach Day", scene: "{hero} builds a sandcastle with a bucket and spade near gentle waves and seashells", story: "At the beach, {hero} builds a tall sandcastle." },
  { title: "Under the Sea Dream", scene: "{hero} swims with friendly fish among seaweed and bubbles", story: "{hero} imagines swimming with the fish. Blub, blub!" },
  { title: "Garden Helper", scene: "{hero} waters a row of sprouting plants with a watering can", story: "{hero} helps the little plants grow big and strong." },
  { title: "Treasure Map", scene: "{hero} and {friend} study a big map spread out on the grass with a compass", story: "They find an old map. Where will it lead?" },
  { title: "Hidden Treasure", scene: "{hero} opens a small chest filled with shells, buttons and shiny stones", story: "The treasure is a box of shiny stones. What a find!" },
  { title: "Bicycle Ride", scene: "{hero} rides a bicycle with a basket of flowers down a country lane", story: "Ring, ring! {hero} rides home along the lane." },
  { title: "Sunset Swing", scene: "{hero} swings on a tree swing as the sun sets behind the hills", story: "The sun is going down. {hero} swings slowly, back and forth." },
  { title: "Stargazing", scene: "{hero} and {friend} lie on a blanket looking up at a sky full of stars and a crescent moon", story: "Look at all the stars! {friend} points to the brightest one." },
  { title: "Bath Time Bubbles", scene: "{hero} in a bathtub full of bubbles with a rubber duck", story: "Bubbles everywhere! {hero} washes away the day." },
  { title: "Sweet Dreams", scene: "{hero} sleeps in a cozy bed with a teddy bear and a night light", story: "Goodnight, {hero}. Goodnight, {friend}. Sweet dreams." },
];

function pickSpecies(theme: string): string {
  const t = theme.toLowerCase();
  return SPECIES.find((s) => t.includes(s)) ?? "little explorer";
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class DemoTextProvider implements TextProvider {
  readonly name = "demo";
  readonly model = "demo-template-writer";
  readonly isDemo = true;

  async planBook(settings: BookSettings): Promise<TextResult<BookPlan>> {
    const h = hash(settings.theme);
    const species = pickSpecies(settings.theme);
    const hero = HERO_NAMES[h % HERO_NAMES.length]!;
    const friend = FRIEND_NAMES[(h >>> 4) % FRIEND_NAMES.length]!;
    const story = settings.mode !== "coloring";
    const characters = [
      { key: slugKey(`${hero}_${species}`), name: hero, role: "main character", description: `A curious, kind ${species} who loves exploring.`, visual_traits: `a small round ${species} with big friendly eyes, a wide smile, short arms and a striped scarf` },
      { key: slugKey(`${friend}_friend`), name: friend, role: "best friend", description: `${hero}'s cheerful best friend.`, visual_traits: `a little bird with a round body, tiny wings, a short beak and a small bow on its head` },
    ];
    const offset = h % SCENES.length;
    const pages: PlannedPage[] = Array.from({ length: settings.illustrationCount }, (_, i) => {
      const s = SCENES[(offset + i) % SCENES.length]!;
      const round = Math.floor(i / SCENES.length);
      const fill = (t: string) => t.replaceAll("{hero}", hero).replaceAll("{friend}", friend);
      return {
        page_number: i + 1,
        scene_title: round ? `${s.title} (Part ${round + 1})` : s.title,
        story_text: story ? fill(s.story) : "",
        scene_description: `${fill(s.scene)}, with a theme of ${settings.theme}${round ? `, seen from a new angle (variation ${round + 1})` : ""}`,
        characters: s.scene.includes("{friend}") ? [characters[0]!.key, characters[1]!.key] : [characters[0]!.key],
        activity: settings.audience === "toddler" || settings.audience === "preschool" ? "Color slowly and stay inside the lines!" : "",
      };
    });
    const title = `${hero}'s ${titleCase(settings.theme).slice(0, 60)}`;
    return {
      provider: this.name,
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0 },
      data: {
        title,
        subtitle: settings.mode === "coloring" ? `A ${getAgeGroup(settings.audience).label} Coloring Book` : `A Story and Coloring Book for ${getAgeGroup(settings.audience).label}`,
        synopsis: `${hero} the ${species} and ${friend} spend a happy day together, from breakfast to bedtime, in a world of ${settings.theme}.`,
        tone: settings.tone,
        outline: ["Morning and setting off", "Adventures outdoors", "Surprises and discoveries", "Heading home and bedtime"],
        characters,
        pages,
      },
    };
  }

  async regeneratePages(input: RegenerateInput): Promise<TextResult<{ pages: PlannedPage[] }>> {
    const hero = input.plan.characters[0]?.name ?? "Our hero";
    const pages = input.targets.map((n, i) => {
      const s = SCENES[(hash(input.instructions + n) + i) % SCENES.length]!;
      const fill = (t: string) => t.replaceAll("{hero}", hero).replaceAll("{friend}", input.plan.characters[1]?.name ?? "a friend");
      return {
        page_number: n,
        scene_title: s.title,
        story_text: input.settings.mode === "coloring" ? "" : fill(s.story),
        scene_description: `${fill(s.scene)}, with a theme of ${input.settings.theme}`,
        characters: input.plan.characters.slice(0, 1).map((c) => c.key),
        activity: "",
      };
    });
    return { provider: this.name, model: this.model, usage: { inputTokens: 0, outputTokens: 0 }, data: { pages } };
  }

  async generateMetadata(input: MetadataInput): Promise<TextResult<MetadataDraft>> {
    const age = getAgeGroup(input.settings.audience);
    const theme = input.settings.theme.toLowerCase();
    const description = [
      `${input.title} is a ${input.settings.mode === "coloring" ? "coloring book" : "story and coloring book"} for ${age.label.toLowerCase()} with ${input.sceneTitles.length} original illustrations to color.`,
      input.synopsis,
      `Inside you'll find:\n• ${input.sceneTitles.slice(0, 6).join("\n• ")}`,
      `Printed single-sided${input.settings.blankBacks ? " so markers won't bleed through" : ""} on ${input.settings.trimSize} inch pages.`,
    ].join("\n\n");
    const words = theme.split(/[^a-z]+/).filter((w) => w.length > 3);
    const base = [`${theme} coloring book`, `coloring book for ${input.settings.audience}`, `${input.settings.category.toLowerCase()} coloring pages`, `${words[0] ?? "cute"} activity book`, "gift for kids who love coloring", `${age.label.split(" ")[0]!.toLowerCase()} coloring activity`, "easy coloring pages"];
    return {
      provider: this.name,
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0 },
      data: {
        title_suggestions: [input.title, `${titleCase(theme)} Coloring Book`, `My Big Book of ${titleCase(words[0] ?? "Fun")}`],
        subtitle_suggestions: [input.subtitle, `${input.sceneTitles.length} Fun Pages to Color for ${age.label}`],
        description,
        age_range: age.label.replace(/^[^(]*\(?|\)$/g, "") || age.label,
        categories: [`Children's Books › Activities, Crafts & Games › Coloring`, `Children's Books › ${input.settings.category}`],
        keywords: base.slice(0, 7),
        keyword_candidates: [...base, `${theme} gift`, `${theme} for beginners`, "relaxing coloring", "screen-free activity"],
        copyright_text: `Copyright © [YEAR] ${input.author || "[Author Name]"}. All rights reserved.\nNo part of this book may be reproduced in any form without written permission from the publisher, except for personal use of the coloring pages.\nIllustrations created with AI assistance.`,
      },
    };
  }
}

function titleCase(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function createTextProvider(config: AppConfig): TextProvider {
  if (config.ai.textProvider === "anthropic") return new AnthropicTextProvider(config.ai);
  if (config.ai.textProvider === "groq") return new GroqTextProvider(config.ai);
  return new DemoTextProvider();
}
