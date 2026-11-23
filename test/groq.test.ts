import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GroqTextProvider, createTextProvider } from "../server/ai/text.ts";
import { validatePlan } from "../server/ai/schemas.ts";
import { loadConfig } from "../server/config.ts";
import { JobError } from "../server/errors.ts";
import { settings } from "./helpers.ts";

/** Mocked Groq HTTP API: these tests do NOT call the live service. */
const cfg = loadConfig({ NODE_ENV: "test", GROQ_API_KEY: "gsk_test", TEXT_PROVIDER: "groq" });
const s = settings({ illustrationCount: 3, mode: "story_coloring" });

const plan = {
  title: "Pip's Picnic", subtitle: "A Coloring Story", synopsis: "Pip has a picnic.", tone: "playful", outline: ["a", "b"],
  characters: [{ key: "pip", name: "Pip", role: "hero", description: "kind", visual_traits: "a small round penguin with a red scarf" }],
  pages: [1, 2, 3].map((n) => ({ page_number: n, scene_title: `Scene ${n}`, story_text: "Pip waddles.", scene_description: `Pip explores place ${n}`, characters: ["pip"], activity: "" })),
};

const reply = (content: unknown, init: { status?: number; finish?: string; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(init.status && init.status >= 400 ? { error: { message: String(content) } } : { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: init.finish ?? "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 }, model: "llama-test" }), { status: init.status ?? 200, headers: init.headers });

describe("Groq text provider (mocked HTTP)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.GROQ_API_KEY = "gsk_test";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEY;
  });

  test("is selected automatically when only GROQ_API_KEY is set", () => {
    expect(loadConfig({ NODE_ENV: "test", GROQ_API_KEY: "x" }).ai.textProvider).toBe("groq");
    expect(loadConfig({ NODE_ENV: "test", GROQ_API_KEY: "x", ANTHROPIC_API_KEY: "y" }).ai.textProvider).toBe("anthropic");
    expect(loadConfig({ NODE_ENV: "test" }).ai.textProvider).toBe("demo");
    expect(createTextProvider(cfg).name).toBe("groq");
  });

  test("returns a validated plan and sends JSON mode with the schema, key only in the header", async () => {
    fetchMock.mockResolvedValueOnce(reply(plan));
    const r = await new GroqTextProvider(cfg.ai).planBook(s);
    expect(validatePlan(r.data, s).plan.pages).toHaveLength(3);
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain('"pages"');
    expect(init.headers.authorization).toBe("Bearer gsk_test");
    expect(init.body).not.toContain("gsk_test");
  });

  test("retries once with the validation error when the JSON does not match", async () => {
    fetchMock.mockResolvedValueOnce(reply({ title: "only a title" })).mockResolvedValueOnce(reply(plan));
    const r = await new GroqTextProvider(cfg.ai).planBook(s);
    expect(r.data.title).toBe("Pip's Picnic");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).messages.at(-1).content).toMatch(/did not match the schema/);
    expect(r.usage.inputTokens).toBe(200);
  });

  test("gives up as a retryable error after two bad replies", async () => {
    fetchMock.mockImplementation(async () => reply("not json at all"));
    await expect(new GroqTextProvider(cfg.ai).planBook(s)).rejects.toMatchObject({ kind: "transient" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("maps rate limits, auth errors and truncation", async () => {
    fetchMock.mockResolvedValueOnce(reply("Rate limit reached for tokens per minute (TPM)", { status: 429, headers: { "retry-after": "7" } }));
    const err = (await new GroqTextProvider(cfg.ai).planBook(s).catch((e) => e)) as JobError;
    expect(err.kind).toBe("rate_limit");
    expect(err.retryAfterMs).toBe(7000);
    expect(err.retryable).toBe(true);
    fetchMock.mockResolvedValueOnce(reply("Invalid API Key", { status: 401 }));
    expect(await new GroqTextProvider(cfg.ai).planBook(s).catch((e) => e)).toMatchObject({ kind: "config" });
    fetchMock.mockResolvedValueOnce(reply(plan, { finish: "length" }));
    expect(await new GroqTextProvider(cfg.ai).planBook(s).catch((e) => e)).toMatchObject({ kind: "permanent" });
  });

  test("missing key is a config error and calls nothing", async () => {
    delete process.env.GROQ_API_KEY;
    expect(await new GroqTextProvider(cfg.ai).planBook(s).catch((e) => e)).toMatchObject({ kind: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
