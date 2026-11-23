import { Trash2 } from "lucide-react";
import { useState } from "react";
import { del, patch } from "../api.ts";
import { SettingsForm } from "../components/settings-form.tsx";
import { bookSettingsSchema, type BookSettings } from "../../../shared/settings.ts";
import { navigate } from "../router.tsx";
import { Alert, Confirm, Field, useAction } from "../ui.tsx";
import { useProject } from "./context.tsx";

export function ProjectSettings() {
  const { data, reload } = useProject();
  const p = data.project;
  const [s, setS] = useState<BookSettings>(p.settings);
  const [meta, setMeta] = useState({ title: p.title, subtitle: p.subtitle, author: p.author, folder: p.folder });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, run } = useAction();
  const dirty = JSON.stringify(s) !== JSON.stringify(p.settings) || meta.title !== p.title || meta.subtitle !== p.subtitle || meta.author !== p.author || meta.folder !== p.folder;
  const parsed = bookSettingsSchema.safeParse(s);
  const styleChanged = s.artStyle !== p.settings.artStyle || s.complexity !== p.settings.complexity || s.audience !== p.settings.audience;

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 880 }}>
      <div className="card stack">
        <h3>Book details</h3>
        <div className="grid-2">
          <Field label="Title" htmlFor="t">
            <input id="t" className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </Field>
          <Field label="Subtitle" htmlFor="st">
            <input id="st" className="input" value={meta.subtitle} onChange={(e) => setMeta({ ...meta, subtitle: e.target.value })} />
          </Field>
          <Field label="Author" htmlFor="a">
            <input id="a" className="input" value={meta.author} onChange={(e) => setMeta({ ...meta, author: e.target.value })} />
          </Field>
          <Field label="Folder" htmlFor="f" hint="Group books on your dashboard, e.g. “Series: Ocean”.">
            <input id="f" className="input" value={meta.folder} onChange={(e) => setMeta({ ...meta, folder: e.target.value })} />
          </Field>
        </div>
      </div>
      <div className="card">
        <SettingsForm value={s} onChange={setS} sections={["concept", "audience", "format", "content", "generation"]} />
      </div>
      {styleChanged && <Alert kind="info">Changing the audience, style or complexity rebuilds the illustration prompts of pages you haven't hand-edited. Existing artwork stays until you regenerate it.</Alert>}
      {!parsed.success && <Alert kind="error">{parsed.error.issues[0]?.path.join(".")}: {parsed.error.issues[0]?.message}</Alert>}
      <div className="row between">
        <button className="btn danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={16} /> Delete book
        </button>
        <div className="row">
          <button className="btn" disabled={!dirty} onClick={() => { setS(p.settings); setMeta({ title: p.title, subtitle: p.subtitle, author: p.author, folder: p.folder }); }}>
            Discard changes
          </button>
          <button className="btn primary" disabled={!dirty || !parsed.success || busy === "save"} onClick={() => run("save", async () => { await patch(`/api/projects/${p.id}`, { ...meta, settings: s }); await reload(); }, "Settings saved")}>
            Save settings
          </button>
        </div>
      </div>
      {confirmDelete && (
        <Confirm
          title="Delete this book?"
          danger
          confirmLabel="Delete forever"
          body={<>This permanently deletes “{p.title || "Untitled"}”, its pages, artwork and exported files. This can't be undone.</>}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await run("del", async () => { await del(`/api/projects/${p.id}`); navigate("/dashboard"); }, "Book deleted");
          }}
        />
      )}
    </div>
  );
}
