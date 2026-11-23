import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { post } from "../api.ts";
import { Link } from "../router.tsx";
import type { Job } from "../types.ts";
import { Badge, formatDate, ProgressBar, useAction } from "../ui.tsx";
import { useProject } from "./context.tsx";

const JOB_LABEL: Record<string, string> = {
  plan_book: "Write concept, characters & page plan",
  regenerate_story: "Rewrite story pages",
  generate_page: "Draw page",
  generate_cover_art: "Paint cover artwork",
  generate_character_ref: "Draw character reference",
  generate_metadata: "Write listing metadata",
  export_book: "Build & validate print files",
};

export function JobRow({ job, pagePosition }: { job: Job; pagePosition?: number }) {
  const { reload } = useProject();
  const { busy, run } = useAction();
  const active = job.status === "queued" || job.status === "running";
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>
          {JOB_LABEL[job.type] ?? job.type}
          {pagePosition ? ` ${pagePosition}` : ""}
        </div>
        {active && job.message && <div className="subtle">{job.message}</div>}
        {job.error && job.status !== "succeeded" && <div className="subtle" style={{ color: job.status === "failed" ? "var(--danger)" : "var(--warning)" }}>{job.error.message}</div>}
      </td>
      <td style={{ width: 150 }}>{active ? <ProgressBar value={job.progress} /> : <Badge status={job.status} />}</td>
      <td className="subtle" style={{ width: 110 }}>
        {job.attempts > 1 ? `attempt ${job.attempts}/${job.maxAttempts} · ` : ""}
        {formatDate(job.createdAt)}
      </td>
      <td style={{ width: 80, textAlign: "right" }}>
        {active && (
          <button className="btn sm ghost" disabled={busy === "c"} onClick={() => run("c", async () => { await post(`/api/jobs/${job.id}/cancel`); await reload(); })}>
            Cancel
          </button>
        )}
      </td>
    </tr>
  );
}

export function Overview() {
  const { data } = useProject();
  const { project: p, pages, jobs, latestExport } = data;
  const illustrated = pages.filter((x) => x.asset).length;
  const approved = pages.filter((x) => x.status === "approved").length;
  const steps = [
    { label: "Plan the story, characters and pages", done: pages.length > 0, busy: p.status === "planning", to: "story", detail: pages.length ? `${pages.length} pages, ${data.characters.length} characters` : "Not planned yet" },
    { label: "Generate illustrations", done: pages.length > 0 && illustrated === pages.length, busy: jobs.some((j) => j.type === "generate_page" && ["queued", "running"].includes(j.status)), to: "pages", detail: `${illustrated}/${pages.length} illustrated` },
    { label: "Review and approve every page", done: pages.length > 0 && approved === pages.length, to: "pages", detail: `${approved}/${pages.length} approved` },
    { label: "Design the cover", done: !!p.coverArtAssetId, to: "cover", detail: p.coverArtAssetId ? "Cover art ready" : "No cover art yet" },
    { label: "Approve listing metadata", done: p.metadataApproved, to: "export", detail: p.metadataApproved ? "Approved" : p.metadata.description ? "Draft — needs approval" : "Not written yet" },
    { label: "Export and validate print files", done: latestExport?.status === "ready_for_review", busy: !!latestExport && ["queued", "building"].includes(latestExport.status), to: "export", detail: latestExport ? latestExport.status.replace(/_/g, " ") : "Not exported yet" },
  ];
  const pageById = new Map(pages.map((x) => [x.id, x.position]));
  return (
    <div className="grid-2" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", alignItems: "start" }}>
      <div className="card">
        <div className="card-title">
          <h3>Workflow</h3>
          <span className="subtle">{steps.filter((s) => s.done).length}/{steps.length} done</span>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          {steps.map((s) => (
            <Link key={s.label} to={`/projects/${p.id}/${s.to}`} className="row" style={{ padding: "10px 8px", borderRadius: 10, textDecoration: "none", color: "inherit" }}>
              {s.busy ? <Loader2 size={20} className="spin" style={{ animation: "spin 1s linear infinite", color: "var(--ink)" }} /> : s.done ? <CheckCircle2 size={20} color="var(--success)" /> : <Circle size={20} color="var(--text-3)" />}
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{s.label}</div>
                <div className="subtle">{s.detail}</div>
              </div>
            </Link>
          ))}
        </div>
        {p.concept.synopsis && (
          <div style={{ marginTop: 16, padding: 14, background: "var(--surface-2)", borderRadius: 12 }}>
            <div className="label">Synopsis</div>
            <p style={{ margin: 0 }}>{p.concept.synopsis}</p>
          </div>
        )}
      </div>
      <div className="stack">
        <div className="card">
          <div className="card-title">
            <h3>Print specs</h3>
          </div>
          <table className="simple">
            <tbody>
              <tr><th>Interior</th><td>{data.interior.pageCount} pages · {data.interior.pageSize.width}″ × {data.interior.pageSize.height}″</td></tr>
              <tr><th>Margins</th><td>inside {data.interior.margins.inside}″ · outside {data.interior.margins.outside}″ · top {data.interior.margins.top}″</td></tr>
              <tr><th>Spine</th><td>{data.coverLayout.spineWidth}″ {data.coverLayout.spineTextAllowed ? "" : "(too thin for spine text)"}</td></tr>
              <tr><th>Cover</th><td>{data.coverLayout.width}″ × {data.coverLayout.height}″ with bleed</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-title">
            <h3>Activity</h3>
          </div>
          {jobs.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No background tasks yet.</p>
          ) : (
            <table className="simple">
              <tbody>
                {jobs.slice(0, 12).map((j) => (
                  <JobRow key={j.id} job={j} pagePosition={j.payload.pageId ? pageById.get(j.payload.pageId) : undefined} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
