import { ImagePlus, Ruler, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assetUrl, patch, post, upload } from "../api.ts";
import { PAPER_TYPES, type Rect } from "../../../shared/kdp.ts";
import type { CoverConfig } from "../../../shared/settings.ts";
import { Link } from "../router.tsx";
import { Alert, DemoBadge, Field, SaveState, Spinner, useAction } from "../ui.tsx";
import { useProject } from "./context.tsx";

/** Live, to-scale preview of the full wrap using the same layout math as the PDF builder. */
function WrapPreview({ cfg, showGuides }: { cfg: CoverConfig; showGuides: boolean }) {
  const { data } = useProject();
  const L = data.coverLayout;
  const W = L.width;
  const H = L.height;
  // Convert PDF coordinates (inches, origin bottom-left) to CSS percentages.
  const box = (r: Rect): React.CSSProperties => ({ left: `${(r.x / W) * 100}%`, width: `${(r.width / W) * 100}%`, top: `${((H - r.y - r.height) / H) * 100}%`, height: `${(r.height / H) * 100}%` });
  const safe = L.frontSafe;
  const panelH = safe.height * 0.3 * cfg.titleScale;
  const panel: Rect = cfg.titlePosition === "top" ? { x: safe.x, y: safe.y + safe.height - panelH, width: safe.width, height: panelH } : { x: safe.x, y: safe.y + 0.55, width: safe.width, height: panelH };
  const thumbs = cfg.showThumbnails ? data.pages.filter((p) => p.asset).slice(0, 4) : [];
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / (W * 72)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);
  const pt = (n: number) => `${n * scale}px`;
  return (
    <div ref={ref} className="cover-wrap-preview" style={{ aspectRatio: `${W} / ${H}`, background: cfg.backgroundColor }} aria-label="Cover wrap preview">
      <div className="zone" style={{ ...box({ x: L.spine.x, y: 0, width: L.spine.width, height: H }), background: cfg.accentColor }} />
      <div className="zone" style={{ ...box({ x: L.front.x, y: 0, width: W - L.front.x, height: H }), overflow: "hidden" }}>
        {data.project.coverArtAssetId && <img src={assetUrl(data.project.coverArtAssetId)} alt="Cover art" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <div className="title-panel" style={{ ...box(panel), borderColor: cfg.titleColor, color: cfg.titleColor }}>
        <div style={{ fontSize: pt(Math.min(L.trim.width * 6 * cfg.titleScale, 72)), lineHeight: 1.05, fontWeight: 600 }}>{cfg.title || data.project.title || "Untitled"}</div>
        {(cfg.subtitle || data.project.subtitle) && <div style={{ fontSize: pt(L.trim.width * 1.8), color: "#2a2540", marginTop: "3%", fontFamily: "var(--font)", fontWeight: 700 }}>{cfg.subtitle || data.project.subtitle}</div>}
      </div>
      {(cfg.author || data.project.author) && (
        <div className="title-panel" style={{ ...box(cfg.titlePosition === "top" ? { x: safe.x + 0.5, y: safe.y, width: safe.width - 1, height: 0.5 } : { x: safe.x + 0.5, y: safe.y + safe.height - 0.5, width: safe.width - 1, height: 0.5 }), border: "none", color: "#221b3a", fontFamily: "var(--font)", fontWeight: 700, fontSize: pt(14) }}>
          {cfg.author || data.project.author}
        </div>
      )}
      <div className="zone" style={{ ...box({ x: L.backSafe.x, y: L.backSafe.y + L.backSafe.height - 0.7, width: L.backSafe.width, height: 0.6 }), color: cfg.titleColor, fontFamily: "var(--display)", fontWeight: 600, textAlign: "center", fontSize: pt(20), overflow: "hidden" }}>
        {cfg.title || data.project.title}
      </div>
      <div className="zone" style={{ ...box({ x: L.backSafe.x, y: L.backSafe.y + L.backSafe.height * 0.55, width: L.backSafe.width, height: L.backSafe.height * 0.3 }), fontSize: pt(11), color: "#221b3a", overflow: "hidden", lineHeight: 1.35 }}>
        {cfg.backText || data.project.metadata.description.split("\n\n")[0] || data.project.concept.synopsis}
      </div>
      {thumbs.length > 0 && (
        <div className="zone" style={{ ...box({ x: L.backSafe.x + L.backSafe.width * 0.18, y: L.barcode.y + L.barcode.height + 0.25, width: L.backSafe.width * 0.64, height: L.backSafe.height * 0.38 }), display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4%" }}>
          {thumbs.map((p) => (
            <div key={p.id} style={{ background: "#fff", border: `1.5px solid ${cfg.titleColor}`, display: "grid", placeItems: "center", overflow: "hidden" }}>
              <img src={assetUrl(p.asset!.id, { thumb: true })} alt="" style={{ height: "100%", objectFit: "contain" }} />
            </div>
          ))}
        </div>
      )}
      {cfg.spineText && L.spineSafe && (
        <div className="zone" style={{ ...box(L.spineSafe), display: "grid", placeItems: "center", overflow: "hidden" }}>
          <span style={{ writingMode: "vertical-rl", color: "#fff", fontFamily: "var(--display)", fontWeight: 600, fontSize: pt(Math.min((L.spineSafe.width * 72) / 0.8, 18)), whiteSpace: "nowrap" }}>
            {[cfg.title || data.project.title, cfg.author || data.project.author].filter(Boolean).join("  •  ")}
          </span>
        </div>
      )}
      {cfg.reserveBarcode && <div className="guide barcode" style={box(L.barcode)}>barcode area</div>}
      {showGuides && (
        <>
          <div className="guide" style={box(L.back)} title="Back trim" />
          <div className="guide" style={box(L.front)} title="Front trim" />
          <div className="guide" style={box(L.spine)} title="Spine" />
          <div className="guide safe" style={box(L.backSafe)} />
          <div className="guide safe" style={box(L.frontSafe)} />
        </>
      )}
    </div>
  );
}

export function CoverStudio() {
  const { data, reload } = useProject();
  const { busy, run } = useAction();
  const p = data.project;
  const L = data.coverLayout;
  const [cfg, setCfg] = useState<CoverConfig>({ ...p.cover, title: p.cover.title || p.title, subtitle: p.cover.subtitle || p.subtitle, author: p.cover.author || p.author });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [guides, setGuides] = useState(true);
  const [artPrompt, setArtPrompt] = useState(p.cover.artPrompt ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const artJob = data.jobs.find((j) => j.type === "generate_cover_art" && ["queued", "running"].includes(j.status));
  const lastArtJob = data.jobs.find((j) => j.type === "generate_cover_art");

  const set = (patchValue: Partial<CoverConfig>) => {
    const next = { ...cfg, ...patchValue };
    setCfg(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState("saving");
      try {
        await patch(`/api/projects/${p.id}`, { cover: next });
        setState("saved");
      } catch {
        setState("error");
      }
    }, 700);
  };

  const paper = PAPER_TYPES[p.settings.paper];
  return (
    <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(320px, 1fr)", alignItems: "start" }}>
      <div className="stack">
        <div className="card">
          <div className="card-title">
            <h3>Full cover wrap</h3>
            <label className="check" style={{ fontSize: "0.85rem" }}>
              <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Trim & safe-area guides
            </label>
          </div>
          <WrapPreview cfg={cfg} showGuides={guides} />
          <div className="row" style={{ marginTop: 10, gap: 16 }}>
            <span className="subtle">← Back</span>
            <div className="grow" />
            <span className="subtle">Front →</span>
          </div>
        </div>
        <div className="card">
          <div className="card-title">
            <h3>
              <Ruler size={16} /> Dimensions
            </h3>
          </div>
          <table className="simple">
            <tbody>
              <tr><th>Full cover (with 0.125″ bleed)</th><td>{L.width}″ × {L.height}″</td></tr>
              <tr><th>Spine width</th><td>{L.spineWidth}″ = {L.pageCount} pages × {paper.spinePerPage}″ ({paper.label.toLowerCase()})</td></tr>
              <tr><th>Spine text</th><td>{L.spineTextAllowed ? "Allowed (more than 79 pages)" : L.spineTextBlockedReason === "narrow" ? `Not printed: the ${L.spineWidth}″ spine is too narrow for readable 7 pt text` : `Not printed: KDP needs 80+ pages, this book has ${L.pageCount}`}</td></tr>
              <tr><th>Barcode area</th><td>{L.barcode.width}″ × {L.barcode.height}″, bottom right of the back cover</td></tr>
            </tbody>
          </table>
          <p className="subtle" style={{ margin: "10px 0 0" }}>The spine is recalculated from the final page count at every export.</p>
        </div>
      </div>
      <div className="stack">
        <div className="card stack">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <h3>Front artwork</h3>
            {data.coverArt?.is_demo && <DemoBadge />}
          </div>
          {data.coverArt && <span className="subtle">{data.coverArt.width} × {data.coverArt.height}px · about {Math.floor(data.coverArt.width / (L.width - L.front.x))} DPI across the front panel</span>}
          {lastArtJob?.status === "failed" && <Alert kind="error">{lastArtJob.error?.message}</Alert>}
          <Field label="Art direction (optional)" hint="The title is typeset separately; the image never contains text.">
            <textarea className="input" rows={2} value={artPrompt} onChange={(e) => setArtPrompt(e.target.value)} placeholder="e.g. the hero waving from a hot-air balloon at sunset" />
          </Field>
          <div className="row">
            <button className="btn primary" disabled={!!artJob || busy === "art"} onClick={() => run("art", async () => { await post(`/api/projects/${p.id}/cover/art`, { prompt: artPrompt }); await reload(); })}>
              {artJob ? <Spinner size={15} /> : <Sparkles size={16} />} {p.coverArtAssetId ? "Regenerate art" : "Generate art"}
            </button>
            <button className="btn" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={16} /> Upload
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run("upload", async () => { await upload(`/api/projects/${p.id}/cover/art/upload`, f); await reload(); }, "Cover art uploaded"); }} />
          </div>
        </div>
        <div className="card stack">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <h3>Text & layout</h3>
            <SaveState state={state} />
          </div>
          <Field label="Title"><input className="input" value={cfg.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Subtitle"><input className="input" value={cfg.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
          <Field label="Author"><input className="input" value={cfg.author} onChange={(e) => set({ author: e.target.value })} /></Field>
          <Field label="Back cover text" hint={<>Leave empty to use the first paragraph of the listing description. <Link to={`/projects/${p.id}/export`}>Edit listing</Link></>}>
            <textarea className="input" rows={4} value={cfg.backText} onChange={(e) => set({ backText: e.target.value })} />
          </Field>
          <div className="grid-3">
            <Field label="Title color"><input type="color" className="input" style={{ height: 42, padding: 4 }} value={cfg.titleColor} onChange={(e) => set({ titleColor: e.target.value })} /></Field>
            <Field label="Background"><input type="color" className="input" style={{ height: 42, padding: 4 }} value={cfg.backgroundColor} onChange={(e) => set({ backgroundColor: e.target.value })} /></Field>
            <Field label="Spine"><input type="color" className="input" style={{ height: 42, padding: 4 }} value={cfg.accentColor} onChange={(e) => set({ accentColor: e.target.value })} /></Field>
          </div>
          <div className="grid-2">
            <Field label="Title position">
              <select className="input" value={cfg.titlePosition} onChange={(e) => set({ titlePosition: e.target.value as CoverConfig["titlePosition"] })}>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </Field>
            <Field label={`Title size (${Math.round(cfg.titleScale * 100)}%)`}>
              <input type="range" min={0.6} max={1.5} step={0.05} value={cfg.titleScale} onChange={(e) => set({ titleScale: Number(e.target.value) })} />
            </Field>
          </div>
          <label className="check"><input type="checkbox" checked={cfg.showThumbnails} onChange={(e) => set({ showThumbnails: e.target.checked })} /> <span>Show 4 page thumbnails on the back</span></label>
          <label className="check"><input type="checkbox" checked={cfg.reserveBarcode} onChange={(e) => set({ reserveBarcode: e.target.checked })} /> <span>Reserve the barcode area (recommended; KDP prints its barcode there)</span></label>
          <label className="check"><input type="checkbox" checked={cfg.spineText} disabled={!L.spineTextAllowed} onChange={(e) => set({ spineText: e.target.checked })} /> <span>Spine text {L.spineTextAllowed ? "" : L.spineTextBlockedReason === "narrow" ? "(spine too narrow)" : "(needs 80+ pages)"}</span></label>
        </div>
      </div>
    </div>
  );
}
