import { BookPlus, FolderOpen, ImageOff, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { assetUrl, get } from "../api.ts";
import { Link } from "../router.tsx";
import { useSession } from "../session.tsx";
import type { ProjectSummary } from "../types.ts";
import { Alert, Badge, DemoBadge, Empty, formatDate, ProgressBar, Spinner, STATUS_LABEL, useToast } from "../ui.tsx";

export function Dashboard() {
  const { config, user } = useSession();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [folder, setFolder] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (folder) params.set("folder", folder);
      get<{ projects: ProjectSummary[] }>(`/api/projects?${params}`)
        .then((r) => setProjects(r.projects))
        .catch((e) => toast.error(e));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, folder]);

  const [allFolders, setAllFolders] = useState<string[]>([]);
  useEffect(() => {
    if (projects && !q && !status && !folder) setAllFolders([...new Set(projects.map((p) => p.folder).filter(Boolean))].sort());
  }, [projects, q, status, folder]);
  const filtered = !!(q || status || folder);
  const totals = useMemo(() => ({ books: projects?.length ?? 0, pages: projects?.reduce((s, p) => s + p.illustrated, 0) ?? 0 }), [projects]);

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Hi{user?.name ? `, ${user.name.split(" ")[0]}` : ""}! Your books</h1>
          <p className="muted" style={{ margin: 0 }}>
            {totals.books} book{totals.books === 1 ? "" : "s"} · {totals.pages} illustrated pages
          </p>
        </div>
        <Link to="/new" className="btn primary">
          <BookPlus size={17} /> New book
        </Link>
      </div>
      {config && (config.textProvider.demo || config.imageProvider.demo) && (
        <div style={{ marginBottom: 18 }}>
          <Alert kind="demo">
            <strong>Demo mode.</strong> {config.textProvider.demo && "Story text comes from a template writer"}
            {config.textProvider.demo && config.imageProvider.demo && " and "}
            {config.imageProvider.demo && "pages are procedural placeholder drawings stamped “DEMO”"}, not AI output. Add <span className="mono">ANTHROPIC_API_KEY</span> / <span className="mono">OPENAI_API_KEY</span> on the server to enable real generation. <Link to="/account">Provider status</Link>
          </Alert>
        </div>
      )}
      <div className="row" style={{ marginBottom: 20 }}>
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 420 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-3)" }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search by title or theme" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search books" />
        </div>
        <select className="input" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {allFolders.length > 0 && (
          <select className="input" style={{ width: "auto" }} value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Filter by folder">
            <option value="">All folders</option>
            {allFolders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </div>
      {!projects ? (
        <div style={{ display: "grid", placeItems: "center", padding: 60 }}>
          <Spinner size={26} />
        </div>
      ) : projects.length === 0 ? (
        filtered ? (
          <Empty title="No books match your filters">Try a different search.</Empty>
        ) : (
          <Empty icon={<BookPlus size={36} color="var(--primary)" />} title="Your shelf is empty" action={<Link to="/new" className="btn primary">Create your first book</Link>}>
            Start with a theme and an audience; the studio plans the rest.
          </Empty>
        )
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="project-card">
              <div className="project-thumb">
                {p.thumbnailAssetId ? <img src={assetUrl(p.thumbnailAssetId, { thumb: true })} alt="" loading="lazy" /> : <ImageOff size={30} color="var(--text-3)" />}
                {p.thumbnailIsDemo && (
                  <span style={{ position: "absolute", top: 8, right: 8 }}>
                    <DemoBadge />
                  </span>
                )}
              </div>
              <div className="body">
                <div className="row between">
                  <Badge status={p.status}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
                  {p.folder && (
                    <span className="subtle row" style={{ gap: 4 }}>
                      <FolderOpen size={13} /> {p.folder}
                    </span>
                  )}
                </div>
                <strong style={{ fontFamily: "var(--display)", fontSize: "1.05rem", lineHeight: 1.25 }}>{p.title || "Untitled book"}</strong>
                <span className="subtle">
                  {p.pageCount} pages · {p.trimSize}″ · {p.mode === "coloring" ? "Coloring" : p.mode === "story" ? "Story" : "Story + coloring"}
                </span>
                {p.pageCount > 0 && <ProgressBar value={(p.approved / p.pageCount) * 100} />}
                <span className="subtle">
                  {p.approved}/{p.pageCount} approved · edited {formatDate(p.updatedAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
