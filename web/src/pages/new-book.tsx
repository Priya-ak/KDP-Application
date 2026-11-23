import { ArrowLeft, ArrowRight, Check, Wand2 } from "lucide-react";
import { useState } from "react";
import { post } from "../api.ts";
import { estimatePages, SettingsForm, type SettingsSection } from "../components/settings-form.tsx";
import { PAPER_TYPES, getTrim, spineWidth } from "../../../shared/kdp.ts";
import { getAgeGroup, getArtStyle } from "../../../shared/options.ts";
import { bookSettingsSchema, defaultSettings, type BookSettings } from "../../../shared/settings.ts";
import { navigate } from "../router.tsx";
import { useSession } from "../session.tsx";
import { Alert, Field, Spinner, useToast } from "../ui.tsx";

const STEPS: Array<{ id: string; label: string; sections: SettingsSection[] }> = [
  { id: "concept", label: "Concept", sections: ["concept"] },
  { id: "audience", label: "Audience & style", sections: ["audience"] },
  { id: "format", label: "Format", sections: ["format"] },
  { id: "content", label: "Pages", sections: ["content"] },
  { id: "generation", label: "Cover & AI", sections: ["generation"] },
  { id: "review", label: "Review", sections: [] },
];

const STARTERS: Array<{ label: string; s: Partial<BookSettings> }> = [
  { label: "Friendly dinosaurs · kids 4–8", s: { theme: "Friendly dinosaurs exploring a jungle, having a picnic and playing games", audience: "kids", artStyle: "kids_cartoon", category: "Dinosaurs", complexity: "medium" } },
  { label: "Bold & easy flowers · seniors", s: { theme: "Big, simple flowers and garden scenes with bold outlines", audience: "senior", artStyle: "bold_easy", category: "Nature & Gardens", complexity: "simple" } },
  { label: "Ocean story · preschool", s: { theme: "A little sea turtle's first adventure across the coral reef", audience: "preschool", artStyle: "storybook", mode: "story_coloring", category: "Ocean & Sea Life", complexity: "simple" } },
  { label: "Mandalas · adults", s: { theme: "Calming mandala patterns inspired by nature", audience: "adult", artStyle: "mandala", category: "Mandalas & Patterns", complexity: "detailed" } },
];

export function NewBookWizard() {
  const { config, user } = useSession();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<BookSettings>(() => defaultSettings());
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const parsed = bookSettingsSchema.safeParse(settings);
  const current = STEPS[step]!;
  const pages = estimatePages(settings);
  const paper = PAPER_TYPES[settings.paper];

  const create = async (planNow: boolean) => {
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the settings.");
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ project: { id: string } }>("/api/projects", { title, author, settings: parsed.data });
      if (planNow) await post(`/api/projects/${r.project.id}/plan`, {});
      toast.success(planNow ? "Book created. Writing the plan…" : "Book created.");
      navigate(`/projects/${r.project.id}/${planNow ? "story" : "overview"}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <h1>New coloring book</h1>
      <p className="muted">Tell the studio about your book. Every setting can be changed later.</p>
      <div className="wizard-steps" role="tablist">
        {STEPS.map((s, i) => (
          <button key={s.id} type="button" role="tab" aria-selected={i === step} className={`ws${i === step ? " active" : ""}${i < step ? " done" : ""}`} onClick={() => setStep(i)}>
            <span className="n">{i < step ? <Check size={13} /> : i + 1}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: 26 }}>
        {step === 0 && (
          <div className="stack" style={{ gap: 22, marginBottom: 22 }}>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>
                Quick start
              </div>
              <div className="row">
                {STARTERS.map((st) => (
                  <button type="button" key={st.label} className="btn sm" onClick={() => setSettings((s) => ({ ...s, ...st.s }))}>
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid-2">
              <Field label="Book title (optional)" htmlFor="title" hint="Leave empty and the planner will suggest one.">
                <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Author name" htmlFor="author">
                <input id="author" className="input" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={150} />
              </Field>
            </div>
          </div>
        )}
        {current.sections.length > 0 && <SettingsForm value={settings} onChange={setSettings} sections={current.sections} />}
        {current.id === "review" && (
          <div className="stack">
            <h2>Ready to plan your book</h2>
            <table className="simple">
              <tbody>
                <tr><th>Theme</th><td>{settings.theme}</td></tr>
                <tr><th>Type</th><td>{settings.mode === "coloring" ? "Coloring only" : settings.mode === "story" ? "Story only" : "Story + coloring"}</td></tr>
                <tr><th>Audience</th><td>{getAgeGroup(settings.audience).label} · {settings.complexity} detail</td></tr>
                <tr><th>Art style</th><td>{getArtStyle(settings.artStyle).label}</td></tr>
                <tr><th>Format</th><td>{getTrim(settings.trimSize).label} · {paper.label} · {settings.bleed ? "bleed" : "no bleed"}</td></tr>
                <tr><th>Pages</th><td>{settings.illustrationCount} illustrations → about {pages} interior pages · spine ≈ {spineWidth(pages, settings.paper).toFixed(3)}″</td></tr>
              </tbody>
            </table>
            {pages < paper.minPages && <Alert kind="warn">About {pages} pages is below KDP's minimum of {paper.minPages}. You can still plan the book and add pages later.</Alert>}
            {config && (config.textProvider.demo || config.imageProvider.demo) && (
              <Alert kind="demo">
                Demo mode is active{config.textProvider.demo ? ": the plan will come from a template writer" : ""}{config.imageProvider.demo ? `${config.textProvider.demo ? " and" : ":"} pages will be placeholder drawings marked DEMO` : ""}. Nothing is sent to an AI provider.
              </Alert>
            )}
            {!parsed.success && <Alert kind="error">{parsed.error.issues[0]?.path.join(".")}: {parsed.error.issues[0]?.message}</Alert>}
          </div>
        )}
      </div>
      <div className="row between" style={{ marginTop: 18 }}>
        <button className="btn" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          <ArrowLeft size={16} /> Back
        </button>
        {current.id === "review" ? (
          <div className="row">
            <button className="btn" disabled={busy || !parsed.success} onClick={() => void create(false)}>
              Save without planning
            </button>
            <button className="btn primary lg" disabled={busy || !parsed.success} onClick={() => void create(true)}>
              {busy ? <Spinner size={16} /> : <Wand2 size={18} />} Create book & write the plan
            </button>
          </div>
        ) : (
          <button className="btn primary" disabled={step === 0 && settings.theme.trim().length < 3} onClick={() => setStep((s) => s + 1)}>
            Next <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
