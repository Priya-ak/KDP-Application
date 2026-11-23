import { CUSTOM_TRIM, PAPER_TYPES, TRIM_SIZES, customTrimId, findTrim, pageLimits, requiredInsideMargin, spineWidth, type PaperType } from "../../../shared/kdp.ts";
import { planInterior } from "../../../shared/layout.ts";
import { AGE_GROUPS, ART_STYLES, BOOK_CATEGORIES, BOOK_MODES, COMPLEXITY_RULES, LANGUAGES, TONES, getAgeGroup } from "../../../shared/options.ts";
import type { BookSettings } from "../../../shared/settings.ts";
import { Field } from "../ui.tsx";

export type SettingsSection = "concept" | "audience" | "format" | "content" | "generation";

interface Props {
  value: BookSettings;
  onChange(next: BookSettings): void;
  sections: SettingsSection[];
}

/** Interior page count for the current settings, from the same layout function the PDF builder uses. */
export function estimatePages(s: BookSettings): number {
  return planInterior(s, Array.from({ length: s.illustrationCount }, (_, i) => ({ id: String(i), storyText: s.mode === "coloring" ? "" : "text", activity: "" }))).pageCount;
}

export function SettingsForm({ value: s, onChange, sections }: Props) {
  const set = <K extends keyof BookSettings>(k: K, v: BookSettings[K]) => onChange({ ...s, [k]: v });
  const show = (x: SettingsSection) => sections.includes(x);
  const pages = estimatePages(s);
  const paper = PAPER_TYPES[s.paper];
  const limits = pageLimits(s.trimSize, s.paper);

  return (
    <div className="stack" style={{ gap: 22 }}>
      {show("concept") && (
        <>
          <Field label="Theme or concept" htmlFor="theme" hint="What is the book about? Be specific: setting, mood, recurring characters.">
            <textarea id="theme" className="input" rows={3} value={s.theme} onChange={(e) => set("theme", e.target.value)} placeholder="e.g. A shy baby dragon learns to share at a seaside village festival" />
          </Field>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Book type
            </div>
            <div className="choice-grid">
              {BOOK_MODES.map((m) => (
                <button type="button" key={m.id} className={`choice${s.mode === m.id ? " selected" : ""}`} onClick={() => set("mode", m.id)} aria-pressed={s.mode === m.id}>
                  <strong>{m.label}</strong>
                  <span>{m.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid-3">
            <Field label="Category" htmlFor="category">
              <select id="category" className="input" value={s.category} onChange={(e) => set("category", e.target.value)}>
                {BOOK_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Language" htmlFor="language">
              <select id="language" className="input" value={s.language} onChange={(e) => set("language", e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tone" htmlFor="tone">
              <select id="tone" className="input" value={s.tone} onChange={(e) => set("tone", e.target.value)}>
                {TONES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          {s.mode !== "coloring" && (
            <Field label="Educational or entertainment goal (optional)" htmlFor="objective">
              <input id="objective" className="input" value={s.objective} onChange={(e) => set("objective", e.target.value)} placeholder="e.g. Learn about sharing; count from 1 to 10" />
            </Field>
          )}
          <Field label="Main characters (optional)" htmlFor="chars" hint="Leave empty to let the planner invent a small cast.">
            <textarea id="chars" className="input" rows={2} value={s.mainCharacters} onChange={(e) => set("mainCharacters", e.target.value)} placeholder="e.g. Pip, a round little dragon with tiny wings and a striped scarf" />
          </Field>
        </>
      )}

      {show("audience") && (
        <>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Target age group
            </div>
            <div className="choice-grid">
              {AGE_GROUPS.map((a) => (
                <button type="button" key={a.id} className={`choice${s.audience === a.id ? " selected" : ""}`} aria-pressed={s.audience === a.id} onClick={() => onChange({ ...s, audience: a.id, complexity: a.complexity })}>
                  <strong>{a.label}</strong>
                  <span>{COMPLEXITY_RULES[a.complexity].label} detail by default</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Art style
            </div>
            <div className="choice-grid">
              {ART_STYLES.map((a) => (
                <button type="button" key={a.id} className={`choice${s.artStyle === a.id ? " selected" : ""}`} aria-pressed={s.artStyle === a.id} onClick={() => set("artStyle", a.id)}>
                  <strong>{a.label}</strong>
                  <span>{a.description}</span>
                </button>
              ))}
            </div>
          </div>
          <Field label="Complexity" htmlFor="complexity" hint={`${COMPLEXITY_RULES[s.complexity].lineWeight}; ${COMPLEXITY_RULES[s.complexity].regions}.`}>
            <select id="complexity" className="input" value={s.complexity} onChange={(e) => set("complexity", e.target.value as BookSettings["complexity"])}>
              {Object.entries(COMPLEXITY_RULES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {show("format") && (
        <>
          <div className="grid-2">
            <Field label="Trim size" htmlFor="trim" hint={findTrim(s.trimSize)?.custom ? `Custom sizes: width ${CUSTOM_TRIM.minWidth}–${CUSTOM_TRIM.maxWidth}", height ${CUSTOM_TRIM.minHeight}–${CUSTOM_TRIM.maxHeight}".` : undefined}>
              <select id="trim" className="input" value={findTrim(s.trimSize)?.custom ? "custom" : s.trimSize} onChange={(e) => set("trimSize", e.target.value === "custom" ? customTrimId(6.5, 9.5) : e.target.value)}>
                {TRIM_SIZES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
                <option value="custom">Custom size…</option>
              </select>
              {findTrim(s.trimSize)?.custom && (
                <div className="row" style={{ marginTop: 6 }}>
                  <input className="input" style={{ width: 90 }} type="number" step={0.01} min={CUSTOM_TRIM.minWidth} max={CUSTOM_TRIM.maxWidth} aria-label="Custom width (inches)" value={findTrim(s.trimSize)!.width} onChange={(e) => set("trimSize", customTrimId(Math.min(CUSTOM_TRIM.maxWidth, Math.max(CUSTOM_TRIM.minWidth, Number(e.target.value) || CUSTOM_TRIM.minWidth)), findTrim(s.trimSize)!.height))} />
                  <span>×</span>
                  <input className="input" style={{ width: 90 }} type="number" step={0.01} min={CUSTOM_TRIM.minHeight} max={CUSTOM_TRIM.maxHeight} aria-label="Custom height (inches)" value={findTrim(s.trimSize)!.height} onChange={(e) => set("trimSize", customTrimId(findTrim(s.trimSize)!.width, Math.min(CUSTOM_TRIM.maxHeight, Math.max(CUSTOM_TRIM.minHeight, Number(e.target.value) || CUSTOM_TRIM.minHeight))))} />
                  <span className="subtle">inches</span>
                </div>
              )}
            </Field>
            <Field label="Ink & paper" htmlFor="paper">
              <select id="paper" className="input" value={s.paper} onChange={(e) => set("paper", e.target.value as PaperType)}>
                {Object.values(PAPER_TYPES).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.bleed} onChange={(e) => set("bleed", e.target.checked)} />
            <span>
              <strong>Bleed</strong> — page size grows by 0.125″ (outside edge) and 0.25″ (height). Only needed if art should run to the edge; this studio keeps art inside the margins.
            </span>
          </label>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Margins (inches)
            </div>
            <div className="grid-3" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
              {(["top", "bottom", "outside", "inside"] as const).map((k) => (
                <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)} htmlFor={`m-${k}`}>
                  <input id={`m-${k}`} className="input" type="number" step={0.05} min={0.25} max={1.5} value={s.margins[k]} onChange={(e) => onChange({ ...s, margins: { ...s.margins, [k]: Math.min(1.5, Math.max(0.25, Number(e.target.value) || 0.25)) } })} />
                </Field>
              ))}
            </div>
            <p className="subtle" style={{ marginTop: 8 }}>
              KDP minimum at ~{pages} pages: inside {requiredInsideMargin(pages)}″, outside {s.bleed ? "0.375" : "0.25"}″. Lower values are raised automatically.
            </p>
          </div>
        </>
      )}

      {show("content") && (
        <>
          <Field label={s.mode === "story" ? "Number of story pages" : "Number of illustrations"} htmlFor="count" hint={`About ${pages} interior pages in total · spine ≈ ${spineWidth(pages, s.paper).toFixed(3)}″ · KDP allows ${limits.min}–${limits.max} pages at this trim and paper.`}>
            <input id="count" className="input" type="number" min={1} max={200} value={s.illustrationCount} onChange={(e) => set("illustrationCount", Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))))} />
          </Field>
          {!limits.available && <p className="subtle" style={{ color: "var(--danger)", marginTop: -12 }}>KDP doesn't offer {paper.label.toLowerCase()} at this trim size.</p>}
          {limits.available && pages > limits.max && <p className="subtle" style={{ color: "var(--danger)", marginTop: -12 }}>That's above KDP's maximum of {limits.max} pages for this trim and paper.</p>}
          {pages < paper.minPages && <p className="subtle" style={{ color: "var(--warning)", marginTop: -12 }}>That's below KDP's minimum of {paper.minPages} pages. Add illustrations or turn on blank backs.</p>}
          {s.mode !== "story" && (
            <label className="check">
              <input type="checkbox" checked={s.blankBacks} onChange={(e) => set("blankBacks", e.target.checked)} />
              <span>
                <strong>Single-sided coloring pages</strong> — a blank back behind every illustration so markers don't bleed through (doubles the page count).
              </span>
            </label>
          )}
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Front matter
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {(
                [
                  ["titlePage", "Title page"],
                  ["copyrightPage", "Copyright page"],
                  ["belongsTo", "“This book belongs to” page"],
                  ["colorTestPage", "Color test page (try markers first)"],
                ] as const
              ).map(([k, label]) => (
                <label className="check" key={k}>
                  <input type="checkbox" checked={s.frontMatter[k]} onChange={(e) => onChange({ ...s, frontMatter: { ...s.frontMatter, [k]: e.target.checked } })} />
                  <span>{label}</span>
                </label>
              ))}
              <Field label="Dedication (optional)" htmlFor="dedication">
                <input id="dedication" className="input" value={s.frontMatter.dedication} onChange={(e) => onChange({ ...s, frontMatter: { ...s.frontMatter, dedication: e.target.value } })} placeholder="For Mia, who colors outside the lines" />
              </Field>
            </div>
          </div>
          {s.mode !== "coloring" && <p className="subtle">Story text is set at {getAgeGroup(s.audience).readingLevel} level, up to about {getAgeGroup(s.audience).maxWordsPerPage} words per page.</p>}
        </>
      )}

      {show("generation") && (
        <>
          <div className="grid-2">
            <Field label="Cover mood" htmlFor="cmood">
              <input id="cmood" className="input" value={s.cover.mood} onChange={(e) => onChange({ ...s, cover: { ...s.cover, mood: e.target.value } })} />
            </Field>
            <Field label="Cover colors (optional)" htmlFor="ccolors">
              <input id="ccolors" className="input" value={s.cover.colorScheme} onChange={(e) => onChange({ ...s, cover: { ...s.cover, colorScheme: e.target.value } })} placeholder="e.g. sunny yellow and sky blue" />
            </Field>
          </div>
          <Field label="Cover notes (optional)" htmlFor="cnotes">
            <input id="cnotes" className="input" value={s.cover.notes} onChange={(e) => onChange({ ...s, cover: { ...s.cover, notes: e.target.value } })} placeholder="e.g. show the dragon flying a kite above the harbor" />
          </Field>
          <div className="grid-2">
            <Field label="Image quality" htmlFor="quality" hint="Higher quality costs more per image with paid providers.">
              <select id="quality" className="input" value={s.generation.quality} onChange={(e) => onChange({ ...s, generation: { ...s.generation, quality: e.target.value as BookSettings["generation"]["quality"] } })}>
                <option value="draft">Draft (fast, cheapest)</option>
                <option value="standard">Standard</option>
                <option value="high">High</option>
              </select>
            </Field>
            <div className="stack" style={{ gap: 8, paddingTop: 24 }}>
              <label className="check">
                <input type="checkbox" checked={s.generation.cleanLineArt} onChange={(e) => onChange({ ...s, generation: { ...s.generation, cleanLineArt: e.target.checked } })} />
                <span>Convert art to pure black-and-white line art</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={s.generation.useCharacterReferences} onChange={(e) => onChange({ ...s, generation: { ...s.generation, useCharacterReferences: e.target.checked } })} />
                <span>Use approved character references (when the provider supports it)</span>
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
