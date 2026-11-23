import { AlertTriangle, ArrowLeft, ArrowRight, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, Copy, Grid3x3, ImagePlus, Lock, RotateCcw, Square, Trash2, Undo2, Unlock, Wand2, XCircle, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, assetUrl, del, patch, post, put, upload } from "../api.ts";
import type { Page } from "../types.ts";
import { Alert, Badge, Confirm, DemoBadge, Empty, Modal, Spinner, useAction, useToast } from "../ui.tsx";
import { Link } from "../router.tsx";
import { useProject } from "./context.tsx";

interface Estimate {
  images: number;
  unitCostUsd: number;
  totalUsd: number;
  remainingQuota: number;
  needsConfirmation: boolean;
  demo: boolean;
}

function PageArt({ page, thumb = true }: { page: Page; thumb?: boolean }) {
  if (page.status === "queued" || page.status === "generating")
    return (
      <div className="placeholder-art">
        <Spinner />
        {page.status === "queued" ? "Queued" : "Drawing…"}
      </div>
    );
  if (page.asset) return <img src={assetUrl(page.asset.id, { thumb })} alt={`Page ${page.position}: ${page.sceneTitle}`} loading="lazy" draggable={false} />;
  if (page.status === "failed")
    return (
      <div className="placeholder-art" style={{ color: "var(--danger)" }}>
        <XCircle size={22} />
        Generation failed
      </div>
    );
  return (
    <div className="placeholder-art">
      <ImagePlus size={22} />
      Not illustrated yet
    </div>
  );
}

function ZoomModal({ page, onClose }: { page: Page; onClose(): void }) {
  const [zoom, setZoom] = useState(0.5);
  return (
    <Modal title={`Page ${page.position} · ${page.sceneTitle}`} onClose={onClose} wide>
      <div className="row" style={{ marginBottom: 10 }}>
        <ZoomIn size={16} />
        <input type="range" min={0.15} max={1.5} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" style={{ width: 220 }} />
        <span className="subtle">{Math.round(zoom * 100)}% of print-resolution pixels</span>
        {page.asset && (
          <span className="subtle">
            · {page.asset.width} × {page.asset.height}px
          </span>
        )}
      </div>
      <div className="zoom-view">{page.asset && <img src={assetUrl(page.asset.id)} alt="" style={{ width: (page.asset.width ?? 1000) * zoom }} />}</div>
      <p className="subtle" style={{ marginTop: 8 }}>
        Look for stray text, logos, broken lines, extra limbs and shapes that won't print cleanly. Automated checks can't see these.
      </p>
    </Modal>
  );
}

function DetailPanel({ page, onSelect }: { page: Page; onSelect(id: string): void }) {
  const { data, reload, mutate } = useProject();
  const { busy, run } = useAction();
  const toast = useToast();
  const pid = data.project.id;
  const [prompt, setPrompt] = useState(page.illustrationPrompt);
  const [zoom, setZoom] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setPrompt(page.illustrationPrompt), [page.id, page.illustrationPrompt]);
  const idx = data.pages.findIndex((p) => p.id === page.id);
  const working = page.status === "queued" || page.status === "generating";
  const replace = (p: Page) => mutate((d) => ({ ...d, pages: d.pages.map((x) => (x.id === p.id ? p : x)) }));

  const move = (delta: number) =>
    run("move", async () => {
      const ids = data.pages.map((p) => p.id);
      const to = idx + delta;
      if (to < 0 || to >= ids.length) return;
      ids.splice(idx, 1);
      ids.splice(to, 0, page.id);
      const r = await put<{ pages: Page[]; warning: string | null }>(`/api/projects/${pid}/pages/order`, { ids });
      mutate((d) => ({ ...d, pages: r.pages }));
      if (r.warning) toast.info(r.warning);
    });

  return (
    <div className="card detail-panel stack" style={{ gap: 14 }}>
      <div className="row between">
        <div className="row">
          <button className="btn icon ghost" disabled={idx <= 0} onClick={() => onSelect(data.pages[idx - 1]!.id)} aria-label="Previous page">
            <ChevronLeft size={18} />
          </button>
          <strong style={{ fontFamily: "var(--display)" }}>Page {page.position}</strong>
          <button className="btn icon ghost" disabled={idx >= data.pages.length - 1} onClick={() => onSelect(data.pages[idx + 1]!.id)} aria-label="Next page">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {page.asset?.isDemo && <DemoBadge />}
          <Badge status={page.status} />
        </div>
      </div>
      <div className="detail-art" onClick={() => page.asset && setZoom(true)} role="button" tabIndex={0} aria-label="Zoom into artwork" onKeyDown={(e) => e.key === "Enter" && page.asset && setZoom(true)}>
        <PageArt page={page} thumb={false} />
      </div>
      <div>
        <strong>{page.sceneTitle}</strong>
        {page.storyText && data.project.settings.mode !== "coloring" && <p className="muted" style={{ margin: "4px 0 0" }}>“{page.storyText}”</p>}
      </div>
      {page.asset && <span className="subtle">{page.asset.provider === "upload" ? "Uploaded artwork" : page.asset.isDemo ? "Placeholder drawing from demo mode (not AI)" : `Generated by ${page.asset.provider}`} · {page.asset.width} × {page.asset.height}px print file</span>}
      {page.lastError && <Alert kind={page.status === "failed" ? "error" : "warn"}>{page.lastError}</Alert>}
      {page.quality && (
        <div className="checks">
          <div className="label">Automated checks</div>
          {page.quality.checks.map((c) => (
            <div key={c.id}>
              {c.status === "pass" ? <CheckCircle2 size={16} color="var(--success)" /> : c.status === "warning" ? <AlertTriangle size={16} color="var(--warning)" /> : <XCircle size={16} color="var(--danger)" />}
              <span>{c.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        {page.locked ? (
          <button className="btn sm" disabled={busy === "rev"} onClick={() => run("rev", async () => replace((await post(`/api/projects/${pid}/pages/${page.id}/review`, { action: "unlock" })).page))}>
            <Unlock size={14} /> Unlock to edit
          </button>
        ) : (
          <>
            <button className="btn sm primary" disabled={!page.asset || working || busy === "rev"} onClick={() => run("rev", async () => replace((await post(`/api/projects/${pid}/pages/${page.id}/review`, { action: "approve" })).page))}>
              <CheckCircle2 size={14} /> Approve & lock
            </button>
            <button className="btn sm" disabled={!page.asset || working || busy === "rev"} onClick={() => run("rev", async () => replace((await post(`/api/projects/${pid}/pages/${page.id}/review`, { action: "reject" })).page))}>
              <XCircle size={14} /> Reject
            </button>
            <button className="btn sm" disabled={working || busy === "gen"} onClick={() => run("gen", async () => { await post(`/api/projects/${pid}/pages/${page.id}/generate`); await reload(); })}>
              {working ? <Spinner size={14} /> : <Wand2 size={14} />} {page.asset ? "Regenerate" : "Generate"}
            </button>
          </>
        )}
      </div>

      {!page.locked && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row between">
            <span className="label">Illustration prompt {page.promptEdited && <Badge status="manual">edited</Badge>}</span>
            {page.promptEdited && (
              <button className="btn sm ghost" onClick={() => run("prompt", async () => replace((await patch(`/api/projects/${pid}/pages/${page.id}`, { resetPrompt: true })).page), "Prompt reset to the generated version")}>
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </div>
          <textarea className="input mono" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ fontSize: "0.78rem" }} />
          <div className="row">
            <button className="btn sm" disabled={prompt === page.illustrationPrompt || busy === "prompt"} onClick={() => run("prompt", async () => replace((await patch(`/api/projects/${pid}/pages/${page.id}`, { illustrationPrompt: prompt })).page), "Prompt saved")}>
              Save prompt
            </button>
            <button className="btn sm ghost" disabled={prompt === page.illustrationPrompt} onClick={() => setPrompt(page.illustrationPrompt)}>
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <button className="btn sm" disabled={page.locked || busy === "up"} onClick={() => fileRef.current?.click()} title="Replace with your own PNG or JPEG">
          <ImagePlus size={14} /> Replace image
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run("up", async () => replace((await upload(`/api/projects/${pid}/pages/${page.id}/image`, f)).page), "Image replaced");
          }}
        />
        <button className="btn sm icon" disabled={idx <= 0 || busy === "move"} onClick={() => move(-1)} aria-label="Move page earlier" title="Move earlier">
          <ArrowLeft size={14} />
        </button>
        <button className="btn sm icon" disabled={idx >= data.pages.length - 1 || busy === "move"} onClick={() => move(1)} aria-label="Move page later" title="Move later">
          <ArrowRight size={14} />
        </button>
        <button className="btn sm icon" onClick={() => run("dup", async () => { const r = await post(`/api/projects/${pid}/pages/${page.id}/duplicate`); await reload(); onSelect(r.page.id); }, "Page duplicated")} aria-label="Duplicate page" title="Duplicate">
          <Copy size={14} />
        </button>
        <button className="btn sm icon" disabled={page.locked} onClick={() => run("undo", async () => replace((await post(`/api/projects/${pid}/pages/${page.id}/undo`)).page), "Change undone")} aria-label="Undo last change" title="Undo last change">
          <Undo2 size={14} />
        </button>
        <button className="btn sm icon danger" disabled={page.locked} onClick={() => setConfirmDelete(true)} aria-label="Delete page" title="Delete">
          <Trash2 size={14} />
        </button>
      </div>
      {zoom && <ZoomModal page={page} onClose={() => setZoom(false)} />}
      {confirmDelete && (
        <Confirm
          title={`Delete page ${page.position}?`}
          danger
          confirmLabel="Delete page"
          body="The page, its text and its artwork are removed from the book. Later pages move up."
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await del(`/api/projects/${pid}/pages/${page.id}`);
            const next = data.pages[idx + 1] ?? data.pages[idx - 1];
            await reload();
            if (next) onSelect(next.id);
          }}
        />
      )}
    </div>
  );
}

export function PageStudio() {
  const { data, reload, mutate } = useProject();
  const { busy, run } = useAction();
  const toast = useToast();
  const pid = data.project.id;
  const [selectedId, setSelectedId] = useState<string | null>(data.pages[0]?.id ?? null);
  const [view, setView] = useState<"grid" | "single">("grid");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [orderWarning, setOrderWarning] = useState<string | null>(null);
  const selected = data.pages.find((p) => p.id === selectedId) ?? data.pages[0] ?? null;
  const missing = data.pages.filter((p) => !p.asset && !p.locked && !["queued", "generating"].includes(p.status)).length;
  const inFlight = data.pages.filter((p) => ["queued", "generating"].includes(p.status)).length;
  const reviewable = data.pages.filter((p) => p.asset && !p.locked && (p.status === "generated" || p.status === "needs_review"));
  const outOfOrder = data.project.settings.mode !== "coloring" && data.pages.some((p, i) => i > 0 && (p.storyIndex ?? 0) < (data.pages[i - 1]!.storyIndex ?? 0));

  const generate = async (confirm: boolean) => {
    try {
      const r = await post(`/api/projects/${pid}/generate`, { scope: "missing", confirm });
      setEstimate(null);
      if (r.message) toast.info(r.message);
      else toast.success(`Generating ${r.jobs.length} page${r.jobs.length === 1 ? "" : "s"} in the background.`);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === "confirmation_required") setEstimate(e.details.estimate);
      else toast.error(e);
    }
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = data.pages.map((p) => p.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    const byId = new Map(data.pages.map((p) => [p.id, p]));
    mutate((d) => ({ ...d, pages: ids.map((id, i) => ({ ...byId.get(id)!, position: i + 1 })) }));
    void run("order", async () => {
      const r = await put<{ pages: Page[]; warning: string | null }>(`/api/projects/${pid}/pages/order`, { ids });
      mutate((d) => ({ ...d, pages: r.pages }));
      setOrderWarning(r.warning);
    }).then(() => reload());
  };

  if (!data.pages.length)
    return <Empty title="No pages yet" action={<Link className="btn primary" to={`/projects/${pid}/story`}>Plan the book first</Link>}>Plan the story to create the page list, then illustrate it here.</Empty>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between">
        <div className="row">
          <button className="btn primary" disabled={!missing || busy === "gen"} onClick={() => run("gen", () => generate(false))}>
            {busy === "gen" ? <Spinner size={15} /> : <Wand2 size={16} />} Generate {missing ? `${missing} missing` : "missing"} page{missing === 1 ? "" : "s"}
          </button>
          <button className="btn" disabled={!reviewable.length || busy === "approve"} onClick={() => run("approve", async () => { for (const p of reviewable.filter((p) => p.quality?.status === "pass")) await post(`/api/projects/${pid}/pages/${p.id}/review`, { action: "approve" }); await reload(); }, "Approved pages that passed every check")}>
            <CheckCheck size={16} /> Approve all passing ({reviewable.filter((p) => p.quality?.status === "pass").length})
          </button>
          {inFlight > 0 && (
            <span className="badge running">
              <Spinner size={12} /> {inFlight} drawing
            </span>
          )}
        </div>
        <div className="row">
          <span className="subtle">
            {data.pages.filter((p) => p.asset).length}/{data.pages.length} illustrated · {data.pages.filter((p) => p.locked).length} approved
          </span>
          <div className="row" style={{ gap: 2, background: "var(--surface-3)", borderRadius: 999, padding: 3 }}>
            <button className={`btn sm ${view === "grid" ? "" : "ghost"}`} onClick={() => setView("grid")} aria-pressed={view === "grid"}>
              <Grid3x3 size={14} /> Grid
            </button>
            <button className={`btn sm ${view === "single" ? "" : "ghost"}`} onClick={() => setView("single")} aria-pressed={view === "single"}>
              <Square size={14} /> Single
            </button>
          </div>
        </div>
      </div>
      {data.pages.some((p) => p.asset?.isDemo) && <Alert kind="demo">Pages marked DEMO are procedural placeholder drawings, not AI illustrations. Replace them with real artwork (configure an image provider and regenerate, or upload your own) before publishing.</Alert>}
      {(orderWarning || outOfOrder) && (
        <Alert kind="warn">
          <div className="row between">
            <span>{orderWarning ?? "Story pages are out of their original order."}</span>
            <button className="btn sm" onClick={() => run("restore", async () => { const r = await post(`/api/projects/${pid}/pages/restore-order`); mutate((d) => ({ ...d, pages: r.pages })); setOrderWarning(null); }, "Story order restored")}>
              Restore story order
            </button>
          </div>
        </Alert>
      )}
      <div className="studio" style={view === "single" ? { gridTemplateColumns: "minmax(0, 560px)", justifyContent: "center" } : undefined}>
        {view === "grid" && (
          <div className="page-grid" aria-label="Pages. Drag to reorder.">
            {data.pages.map((p) => (
              <div
                key={p.id}
                className={`page-tile${selected?.id === p.id ? " selected" : ""}${dragId === p.id ? " dragging" : ""}${overId === p.id && dragId !== p.id ? " drop-target" : ""}`}
                draggable
                onDragStart={(e) => {
                  setDragId(p.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverId(p.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(p.id);
                  setOverId(null);
                }}
                onClick={() => setSelectedId(p.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedId(p.id)}
                aria-label={`Page ${p.position}, ${p.sceneTitle}, ${p.status}`}
              >
                <span className="num">{p.position}</span>
                {p.locked && (
                  <span className="lock">
                    <Lock size={11} />
                  </span>
                )}
                <div className="art">
                  <PageArt page={p} />
                </div>
                <div className="meta">
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.sceneTitle}</span>
                  <div className="row" style={{ gap: 4 }}>
                    <Badge status={p.status} />
                    {p.asset?.isDemo && <DemoBadge />}
                    {p.quality && p.quality.status !== "pass" && <AlertTriangle size={14} color="var(--warning)" aria-label="Has quality warnings" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {selected && <DetailPanel page={selected} onSelect={setSelectedId} />}
      </div>
      {estimate && (
        <Confirm
          title="Confirm this batch"
          confirmLabel={`Generate ${estimate.images} images`}
          body={
            <>
              This batch generates <strong>{estimate.images}</strong> images at about ${estimate.unitCostUsd.toFixed(3)} each, roughly <strong>${estimate.totalUsd.toFixed(2)}</strong> with your image provider. You have {estimate.remainingQuota} images left in this month's quota. Estimates use configured prices; your provider's bill is authoritative.
            </>
          }
          onClose={() => setEstimate(null)}
          onConfirm={() => generate(true)}
        />
      )}
    </div>
  );
}
