import { Lock, Plus, RefreshCw, Sparkles, Trash2, UserPlus, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, assetUrl, del, patch, post } from "../api.ts";
import type { Character, Page } from "../types.ts";
import { Alert, Badge, Confirm, DemoBadge, Empty, Field, Modal, ProgressBar, SaveState, Spinner, useAction, useToast } from "../ui.tsx";
import { useProject } from "./context.tsx";

/** Debounced autosave of an object of fields. */
function useDraft<T extends Record<string, unknown>>(initial: T, save: (v: T) => Promise<unknown>, deps: unknown[]) {
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!timer.current) setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const update = (patchValue: Partial<T>) => {
    setDraft((d) => {
      const next = { ...d, ...patchValue };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        timer.current = null;
        setState("saving");
        try {
          await saveRef.current(next);
          setState("saved");
        } catch {
          setState("error");
        }
      }, 900);
      return next;
    });
  };
  return { draft, update, state };
}

function CharacterCard({ c }: { c: Character }) {
  const { data, reload } = useProject();
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const pid = data.project.id;
  const { draft, update, state } = useDraft({ name: c.name, role: c.role, description: c.description, visualTraits: c.visualTraits }, (v) => patch(`/api/projects/${pid}/characters/${c.id}`, v), [c.name, c.role, c.description, c.visualTraits]);
  const refJob = data.jobs.find((j) => j.type === "generate_character_ref" && j.payload.characterId === c.id && ["queued", "running"].includes(j.status));
  return (
    <div className="card flat stack" style={{ padding: 16 }}>
      <div className="row between">
        <div className="row">
          <strong style={{ fontFamily: "var(--display)", fontSize: "1.05rem" }}>{c.name}</strong>
          <span className="mono subtle">{c.key}</span>
        </div>
        <div className="row">
          <SaveState state={state} />
          <button className="btn icon ghost" aria-label={`Delete ${c.name}`} onClick={() => setConfirm(true)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0,1fr) 150px" }}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="grid-2">
            <Field label="Name">
              <input className="input" value={draft.name} onChange={(e) => update({ name: e.target.value })} />
            </Field>
            <Field label="Role">
              <input className="input" value={draft.role} onChange={(e) => update({ role: e.target.value })} />
            </Field>
          </div>
          <Field label="Visual traits (repeated in every illustration prompt)" hint="Shape, clothing, distinctive features. No colors: the art is black and white.">
            <textarea className="input" rows={2} value={draft.visualTraits} onChange={(e) => update({ visualTraits: e.target.value })} />
          </Field>
          <Field label="Personality & story role">
            <textarea className="input" rows={2} value={draft.description} onChange={(e) => update({ description: e.target.value })} />
          </Field>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="detail-art" style={{ aspectRatio: "1", cursor: "default" }}>
            {refJob ? <Spinner /> : c.referenceAssetId ? <img src={assetUrl(c.referenceAssetId, { thumb: true })} alt={`${c.name} reference`} /> : <span className="placeholder-art">No reference yet</span>}
          </div>
          <button className="btn sm" disabled={!!refJob || busy === "ref"} onClick={() => run("ref", async () => { await post(`/api/projects/${pid}/characters/${c.id}/reference`); await reload(); })}>
            <Sparkles size={14} /> {c.referenceAssetId ? "Redraw" : "Draw reference"}
          </button>
          {c.referenceAssetId && (
            <label className="check" style={{ fontSize: "0.82rem" }}>
              <input type="checkbox" checked={c.referenceApproved} onChange={(e) => run("appr", async () => { await patch(`/api/projects/${pid}/characters/${c.id}`, { referenceApproved: e.target.checked }); await reload(); })} />
              <span>Approved reference</span>
            </label>
          )}
        </div>
      </div>
      {confirm && <Confirm title={`Delete ${c.name}?`} danger confirmLabel="Delete" body="The character is removed from every page and prompt." onClose={() => setConfirm(false)} onConfirm={async () => { await del(`/api/projects/${pid}/characters/${c.id}`); await reload(); }} />}
    </div>
  );
}

function PageRow({ page, selected, onSelect }: { page: Page; selected: boolean; onSelect(v: boolean): void }) {
  const { data } = useProject();
  const mode = data.project.settings.mode;
  const pid = data.project.id;
  const toast = useToast();
  const { draft, update, state } = useDraft(
    { sceneTitle: page.sceneTitle, storyText: page.storyText, sceneDescription: page.sceneDescription, characters: page.characters },
    async (v) => {
      try {
        await patch(`/api/projects/${pid}/pages/${page.id}`, v);
      } catch (e) {
        toast.error(e);
        throw e;
      }
    },
    [page.updatedAt],
  );
  return (
    <div className="card flat" style={{ padding: 16, opacity: page.locked ? 0.85 : 1 }}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={selected} disabled={page.locked} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select page ${page.position}`} />
          <span className="badge" style={{ background: "var(--text)", color: "var(--bg)" }}>
            {page.position}
          </span>
          {page.storyIndex && page.storyIndex !== page.position && <span className="subtle">(story beat {page.storyIndex})</span>}
        </label>
        <div className="row">
          <SaveState state={state} />
          {page.locked && (
            <span className="badge approved">
              <Lock size={12} /> Approved
            </span>
          )}
        </div>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <input className="input" value={draft.sceneTitle} disabled={page.locked} onChange={(e) => update({ sceneTitle: e.target.value })} aria-label="Scene title" style={{ fontWeight: 600 }} />
        {mode !== "coloring" && (
          <Field label="Story text (printed on the page)">
            <textarea className="input" rows={2} value={draft.storyText} disabled={page.locked} onChange={(e) => update({ storyText: e.target.value })} />
          </Field>
        )}
        <Field label="Scene description (for the illustrator)">
          <textarea className="input" rows={2} value={draft.sceneDescription} disabled={page.locked} onChange={(e) => update({ sceneDescription: e.target.value })} />
        </Field>
        {data.characters.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            <span className="subtle">In this scene:</span>
            {data.characters.map((c) => {
              const on = draft.characters.includes(c.key);
              return (
                <button key={c.id} type="button" className="chip" disabled={page.locked} style={{ cursor: "pointer", border: on ? "1px solid var(--primary)" : "1px solid transparent", background: on ? "var(--primary-soft)" : undefined }} onClick={() => update({ characters: on ? draft.characters.filter((k) => k !== c.key) : [...draft.characters, c.key] })} aria-pressed={on}>
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function StoryWorkspace() {
  const { data, reload } = useProject();
  const { busy, run } = useAction();
  const toast = useToast();
  const p = data.project;
  const [selected, setSelected] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [replan, setReplan] = useState(false);
  const [replanNote, setReplanNote] = useState("");
  const [newChar, setNewChar] = useState(false);
  const [charDraft, setCharDraft] = useState({ name: "", role: "", visualTraits: "", description: "" });
  const planJob = data.jobs.find((j) => j.type === "plan_book" && ["queued", "running"].includes(j.status));
  const lastPlanFail = data.jobs.find((j) => j.type === "plan_book");
  const storyJob = data.jobs.find((j) => j.type === "regenerate_story" && ["queued", "running"].includes(j.status));
  const issues = p.concept.issues ?? [];

  const startPlan = (replace: boolean, note = "") =>
    run("plan", async () => {
      try {
        await post(`/api/projects/${p.id}/plan`, { replace, instructions: note });
      } catch (e) {
        if (e instanceof ApiError && e.details?.requiresReplace) {
          setReplan(true);
          return;
        }
        throw e;
      }
      await reload();
    });

  if (planJob)
    return (
      <div className="card" style={{ maxWidth: 620, margin: "30px auto", textAlign: "center", padding: 32 }}>
        <Spinner size={30} />
        <h2 style={{ marginTop: 14 }}>Writing your book plan…</h2>
        <p className="muted">{planJob.message || "Queued"}</p>
        <ProgressBar value={planJob.progress} />
      </div>
    );

  if (!data.pages.length)
    return (
      <div className="stack">
        {lastPlanFail?.status === "failed" && <Alert kind="error">The last planning run failed: {lastPlanFail.error?.message}</Alert>}
        <Empty icon={<Wand2 size={38} color="var(--primary)" />} title="No plan yet" action={<button className="btn primary lg" disabled={busy === "plan"} onClick={() => startPlan(false)}>{busy === "plan" ? <Spinner size={16} /> : <Wand2 size={18} />} Write the concept & page plan</button>}>
          The planner writes a title, synopsis, character bible and {p.settings.illustrationCount} scenes from your brief. You can edit everything afterwards.
        </Empty>
      </div>
    );

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="card-title">
          <h3>Concept</h3>
          <div className="row">
            {p.concept.provider === "demo" ? <DemoBadge /> : p.concept.model && <span className="subtle">by {p.concept.model}</span>}
            <button className="btn sm" onClick={() => setReplan(true)}>
              <RefreshCw size={14} /> Re-plan book
            </button>
          </div>
        </div>
        {p.concept.provider === "demo" && <div style={{ marginBottom: 12 }}><Alert kind="demo">This plan was produced by the demo template writer, not an AI model. Edit the text freely, or configure ANTHROPIC_API_KEY and re-plan.</Alert></div>}
        <p style={{ fontSize: "1.02rem" }}>{p.concept.synopsis}</p>
        {p.concept.outline && p.concept.outline.length > 0 && (
          <ol className="muted" style={{ margin: 0, paddingLeft: 20 }}>
            {p.concept.outline.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ol>
        )}
        {issues.length > 0 && (
          <div className="stack" style={{ marginTop: 14, gap: 6 }}>
            <div className="label">Plan checks</div>
            {issues.map((i, k) => (
              <div key={k} className="row" style={{ gap: 8, fontSize: "0.88rem" }}>
                <Badge status={i.severity === "error" ? "error" : i.severity === "warning" ? "warning" : "manual"}>{i.severity}</Badge>
                {i.page ? <span className="subtle">page {i.page}</span> : null}
                <span>{i.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Character bible</h2>
          <button className="btn sm" onClick={() => setNewChar(true)}>
            <UserPlus size={15} /> Add character
          </button>
        </div>
        {data.characters.length === 0 ? (
          <p className="muted">No recurring characters. Add one to keep a hero consistent across pages.</p>
        ) : (
          <div className="stack">{data.characters.map((c) => <CharacterCard key={c.id} c={c} />)}</div>
        )}
      </div>

      <div>
        <div className="row between" style={{ marginBottom: 12, position: "sticky", top: 62, zIndex: 5, background: "var(--bg)", padding: "8px 0" }}>
          <h2 style={{ margin: 0 }}>Pages ({data.pages.length})</h2>
          <div className="row">
            {selected.length > 0 && (
              <>
                <input className="input" style={{ width: 280 }} placeholder="Instructions, e.g. make it funnier" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
                <button className="btn primary sm" disabled={!!storyJob || busy === "regen"} onClick={() => run("regen", async () => { await post(`/api/projects/${p.id}/story/regenerate`, { pageIds: selected, instructions }); setSelected([]); await reload(); toast.info("Rewriting selected pages…"); })}>
                  {storyJob ? <Spinner size={14} /> : <Sparkles size={14} />} Rewrite {selected.length} page{selected.length === 1 ? "" : "s"}
                </button>
              </>
            )}
            {storyJob && <span className="badge running"><Spinner size={12} /> Rewriting…</span>}
            <button className="btn sm" disabled={busy === "add"} onClick={() => run("add", async () => { await post(`/api/projects/${p.id}/pages`, {}); await reload(); }, "Page added")}>
              <Plus size={15} /> Add page
            </button>
          </div>
        </div>
        <div className="stack">
          {data.pages.map((pg) => (
            <PageRow key={pg.id} page={pg} selected={selected.includes(pg.id)} onSelect={(v) => setSelected((s) => (v ? [...s, pg.id] : s.filter((x) => x !== pg.id)))} />
          ))}
        </div>
      </div>

      {replan && (
        <Modal
          title="Re-plan the whole book?"
          onClose={() => setReplan(false)}
          footer={
            <>
              <button className="btn" onClick={() => setReplan(false)}>Cancel</button>
              <button className="btn danger" disabled={busy === "plan"} onClick={async () => { setReplan(false); await startPlan(true, replanNote); }}>Replace all pages</button>
            </>
          }
        >
          <p className="muted">This replaces every page, its text and its artwork, and the character bible. Approved (locked) pages must be unlocked first. To change only some pages, select them and use “Rewrite”.</p>
          <Field label="Extra instructions (optional)">
            <textarea className="input" rows={3} value={replanNote} onChange={(e) => setReplanNote(e.target.value)} placeholder="e.g. Set it in winter and add a snowman friend" />
          </Field>
        </Modal>
      )}
      {newChar && (
        <Modal
          title="Add a character"
          onClose={() => setNewChar(false)}
          footer={
            <>
              <button className="btn" onClick={() => setNewChar(false)}>Cancel</button>
              <button className="btn primary" disabled={!charDraft.name.trim() || busy === "char"} onClick={() => run("char", async () => { await post(`/api/projects/${p.id}/characters`, charDraft); setCharDraft({ name: "", role: "", visualTraits: "", description: "" }); setNewChar(false); await reload(); }, "Character added")}>Add character</button>
            </>
          }
        >
          <div className="stack">
            <div className="grid-2">
              <Field label="Name"><input className="input" value={charDraft.name} onChange={(e) => setCharDraft({ ...charDraft, name: e.target.value })} /></Field>
              <Field label="Role"><input className="input" value={charDraft.role} onChange={(e) => setCharDraft({ ...charDraft, role: e.target.value })} placeholder="best friend" /></Field>
            </div>
            <Field label="Visual traits"><textarea className="input" rows={2} value={charDraft.visualTraits} onChange={(e) => setCharDraft({ ...charDraft, visualTraits: e.target.value })} placeholder="a tall giraffe with round glasses and a backpack" /></Field>
            <Field label="Personality"><textarea className="input" rows={2} value={charDraft.description} onChange={(e) => setCharDraft({ ...charDraft, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
