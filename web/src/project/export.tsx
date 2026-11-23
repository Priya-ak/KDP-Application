import { Download, FileArchive, FileText, Package, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assetUrl, get, patch, post } from "../api.ts";
import type { BookMetadata, ValidationReport } from "../../../shared/settings.ts";
import type { ExportRecord } from "../types.ts";
import { Alert, Badge, DemoBadge, Field, formatDate, ProgressBar, SaveState, Spinner, StatusIcon, useAction } from "../ui.tsx";
import { useProject } from "./context.tsx";

function MetadataEditor() {
  const { data, reload } = useProject();
  const { busy, run } = useAction();
  const p = data.project;
  const [md, setMd] = useState<BookMetadata>(p.metadata);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [kw, setKw] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const job = data.jobs.find((j) => j.type === "generate_metadata" && ["queued", "running"].includes(j.status));
  useEffect(() => {
    if (!timer.current) setMd(p.metadata);
  }, [p.metadata]);

  const set = (patchValue: Partial<BookMetadata>) => {
    const next = { ...md, ...patchValue };
    setMd(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      setState("saving");
      try {
        await patch(`/api/projects/${p.id}`, { metadata: next });
        setState("saved");
        await reload();
      } catch {
        setState("error");
      }
    }, 800);
  };
  const addKeyword = (k: string) => {
    const v = k.trim().slice(0, 50);
    if (!v || md.keywords.includes(v) || md.keywords.length >= 7) return;
    set({ keywords: [...md.keywords, v] });
  };

  if (!md.description && !job)
    return (
      <div className="card stack">
        <h3>KDP listing</h3>
        <p className="muted">Generate a book description, age range, categories, 7 keywords and a copyright page draft from your book. You'll review and edit everything before approving it.</p>
        <button className="btn primary" disabled={busy === "md" || !data.pages.length} onClick={() => run("md", async () => { await post(`/api/projects/${p.id}/metadata/generate`); await reload(); })}>
          <Sparkles size={16} /> Write listing metadata
        </button>
      </div>
    );

  return (
    <div className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        <h3>KDP listing</h3>
        <div className="row">
          <SaveState state={state} />
          {p.concept.provider === "demo" && <DemoBadge />}
          <button className="btn sm" disabled={!!job || busy === "md"} onClick={() => run("md", async () => { await post(`/api/projects/${p.id}/metadata/generate`); await reload(); })}>
            {job ? <Spinner size={13} /> : <Sparkles size={14} />} Rewrite
          </button>
        </div>
      </div>
      {p.metadataApproved ? <Alert kind="success">Approved. Editing any field withdraws approval.</Alert> : <Alert kind="info">Draft. Review every field, then approve. Nothing is sent to Amazon; you paste these into KDP yourself.</Alert>}
      <div className="grid-2">
        <Field label="Title"><input className="input" value={md.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Subtitle"><input className="input" value={md.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
      </div>
      {md.titleSuggestions.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="subtle">Title ideas:</span>
          {md.titleSuggestions.map((t) => (
            <button key={t} className="chip" style={{ cursor: "pointer", border: "none" }} onClick={() => set({ title: t })}>
              {t}
            </button>
          ))}
        </div>
      )}
      <Field label={`Description (${md.description.length}/4000)`} hint="No URLs, review requests, prices or ranking claims: KDP may reject them.">
        <textarea className="input" rows={8} value={md.description} onChange={(e) => set({ description: e.target.value.slice(0, 4000) })} />
      </Field>
      <div className="grid-2">
        <Field label="Age range"><input className="input" value={md.ageRange} onChange={(e) => set({ ageRange: e.target.value })} /></Field>
        <Field label="Author name"><input className="input" value={md.authorName} onChange={(e) => set({ authorName: e.target.value })} /></Field>
      </div>
      <Field label="Category ideas (one per line)" hint="KDP's category picker changes; choose the closest match there.">
        <textarea className="input" rows={2} value={md.categories.join("\n")} onChange={(e) => set({ categories: e.target.value.split("\n").slice(0, 10) })} />
      </Field>
      <div className="field">
        <label>Keywords ({md.keywords.length}/7 KDP slots)</label>
        <div className="row" style={{ gap: 6 }}>
          {md.keywords.map((k) => (
            <span key={k} className="chip">
              {k}
              <button aria-label={`Remove ${k}`} onClick={() => set({ keywords: md.keywords.filter((x) => x !== k) })}>
                <X size={13} />
              </button>
            </span>
          ))}
          {md.keywords.length < 7 && (
            <input className="input" style={{ width: 200, padding: "5px 10px" }} placeholder="Add keyword + Enter" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addKeyword(kw); setKw(""); } }} />
          )}
        </div>
        {md.keywordCandidates.filter((k) => !md.keywords.includes(k)).length > 0 && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <span className="subtle">More ideas:</span>
            {md.keywordCandidates.filter((k) => !md.keywords.includes(k)).slice(0, 14).map((k) => (
              <button key={k} className="chip" style={{ cursor: "pointer", border: "none" }} disabled={md.keywords.length >= 7} onClick={() => addKeyword(k)}>
                <Plus size={12} /> {k}
              </button>
            ))}
          </div>
        )}
      </div>
      <Field label="Copyright page draft" hint="Printed on the copyright page. [YEAR] is filled in at export.">
        <textarea className="input" rows={3} value={md.copyrightText} onChange={(e) => set({ copyrightText: e.target.value })} />
      </Field>
      <Field label="AI-content note (for KDP's disclosure questions)">
        <input className="input" value={md.aiDisclosure} onChange={(e) => set({ aiDisclosure: e.target.value })} />
      </Field>
      {md.checklist.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">Publishing checklist</div>
          {md.checklist.map((c) => (
            <label className="check" key={c.id}>
              <input type="checkbox" checked={c.done} onChange={(e) => set({ checklist: md.checklist.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)) })} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
      <p className="subtle" style={{ margin: 0 }}>Suggestions only: no metadata can guarantee rankings, sales, discoverability or copyright clearance.</p>
      <div className="row">
        {p.metadataApproved ? (
          <button className="btn" onClick={() => run("appr", async () => { await patch(`/api/projects/${p.id}`, { metadataApproved: false }); await reload(); })}>Withdraw approval</button>
        ) : (
          <button className="btn primary" disabled={!md.description || busy === "appr" || state === "saving"} onClick={() => run("appr", async () => { await patch(`/api/projects/${p.id}`, { metadata: md, metadataApproved: true }); await reload(); }, "Listing approved")}>
            Approve listing
          </button>
        )}
      </div>
    </div>
  );
}

function Report({ report }: { report: ValidationReport }) {
  const categories = [...new Set(report.findings.map((f) => f.category))];
  const order = { error: 0, warning: 1, manual: 2, pass: 3 } as const;
  return (
    <div className="stack">
      <div className="grid-3" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <div className="stat"><b style={{ color: "var(--danger)" }}>{report.summary.error}</b><span className="subtle">errors</span></div>
        <div className="stat"><b style={{ color: "var(--warning)" }}>{report.summary.warning}</b><span className="subtle">warnings</span></div>
        <div className="stat"><b style={{ color: "var(--sky)" }}>{report.summary.manual}</b><span className="subtle">manual review</span></div>
        <div className="stat"><b style={{ color: "var(--success)" }}>{report.summary.pass}</b><span className="subtle">passed</span></div>
      </div>
      {categories
        .map((c) => ({ c, items: report.findings.filter((f) => f.category === c).sort((a, b) => order[a.status] - order[b.status]) }))
        .sort((a, b) => order[a.items[0]!.status] - order[b.items[0]!.status])
        .map(({ c, items }) => (
          <div key={c}>
            <div className="label" style={{ marginTop: 6 }}>{c}</div>
            {items.map((f) => (
              <div key={f.id} className="finding">
                <StatusIcon status={f.status} />
                <div>
                  <div style={{ fontWeight: 600 }}>{f.title}</div>
                  <div className="muted" style={{ fontSize: "0.9rem" }}>{f.detail}</div>
                  {f.fix && f.status !== "pass" && <div className="fix"><strong>{f.status === "manual" ? "How to check:" : "Fix:"}</strong> {f.fix}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
      <div className="subtle">
        {report.limitations.map((l) => (
          <div key={l}>• {l}</div>
        ))}
      </div>
    </div>
  );
}

export function ExportCenter() {
  const { data, reload } = useProject();
  const { busy, run } = useAction();
  const p = data.project;
  const [includeImages, setIncludeImages] = useState(false);
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const exp = data.latestExport;
  const job = exp ? data.jobs.find((j) => j.id === exp.jobId) : undefined;
  const building = !!exp && ["queued", "building"].includes(exp.status);
  useEffect(() => {
    get<{ exports: ExportRecord[] }>(`/api/projects/${p.id}/exports`).then((r) => setHistory(r.exports)).catch(() => undefined);
  }, [p.id, exp?.id, exp?.status]);
  const unapproved = data.pages.filter((x) => x.status !== "approved").length;
  const missing = data.pages.filter((x) => !x.asset).length;

  return (
    <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", alignItems: "start" }}>
      <MetadataEditor />
      <div className="stack">
        <div className="card stack">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <h3>Print files</h3>
            {exp && <Badge status={exp.status} />}
          </div>
          {missing > 0 && <Alert kind="warn">{missing} page{missing === 1 ? " has" : "s have"} no artwork yet; the export will report {missing === 1 ? "it" : "them"} as errors.</Alert>}
          {missing === 0 && unapproved > 0 && <Alert kind="info">{unapproved} page{unapproved === 1 ? " is" : "s are"} not approved yet. You can export a proof now; the report will flag them.</Alert>}
          <label className="check">
            <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} />
            <span>Include print-ready source images in the ZIP package</span>
          </label>
          <div className="row">
            <button className="btn primary" disabled={building || busy === "exp" || !data.pages.length} onClick={() => run("exp", async () => { await post(`/api/projects/${p.id}/exports`, { includeImages }); await reload(); })}>
              {building ? <Spinner size={15} /> : <Package size={16} />} {building ? "Building…" : "Build & validate print files"}
            </button>
          </div>
          {building && (
            <div className="stack" style={{ gap: 6 }}>
              <ProgressBar value={job?.progress ?? 3} />
              <span className="subtle">{job?.message || "Queued"}</span>
            </div>
          )}
          {exp?.status === "failed" && <Alert kind="error">Export failed: {exp.error}</Alert>}
          {exp && exp.report && (
            <>
              {exp.status === "ready_for_review" ? (
                <Alert kind="success">No blocking errors. Review the warnings and manual checks, then upload both PDFs to KDP and check every page in the Print Previewer. Passing these checks doesn't guarantee KDP acceptance.</Alert>
              ) : (
                <Alert kind="error">Blocking errors were found. Fix them and export again before uploading to KDP. The files are still available as proofs.</Alert>
              )}
              <div className="row">
                {exp.interiorAssetId && (
                  <a className="btn" href={assetUrl(exp.interiorAssetId, { download: true })}>
                    <FileText size={16} /> Interior PDF ({exp.spec.pageCount} pages)
                  </a>
                )}
                {exp.coverAssetId && (
                  <a className="btn" href={assetUrl(exp.coverAssetId, { download: true })}>
                    <Download size={16} /> Cover PDF
                  </a>
                )}
                {exp.packageAssetId && (
                  <a className="btn ink" href={assetUrl(exp.packageAssetId, { download: true })}>
                    <FileArchive size={16} /> Full package (.zip)
                  </a>
                )}
              </div>
              <span className="subtle">
                Exported {formatDate(exp.finishedAt ?? exp.createdAt)} · cover {exp.spec.coverWidth}″ × {exp.spec.coverHeight}″ · spine {exp.spec.spineWidth}″
              </span>
            </>
          )}
        </div>
        {exp?.report && (
          <div className="card">
            <div className="card-title">
              <h3>KDP validation report</h3>
            </div>
            <Report report={exp.report} />
          </div>
        )}
        {history.length > 1 && (
          <div className="card">
            <div className="card-title">
              <h3>Export history</h3>
            </div>
            <table className="simple">
              <thead>
                <tr><th>When</th><th>Status</th><th>Pages</th><th>Files</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDate(h.createdAt)}</td>
                    <td><Badge status={h.status} /></td>
                    <td>{h.spec.pageCount ?? "—"}</td>
                    <td>{h.packageAssetId ? <a href={assetUrl(h.packageAssetId, { download: true })}>ZIP</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
