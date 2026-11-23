import { BookOpen, FileCheck2, Images, LayoutDashboard, Palette, Settings2 } from "lucide-react";
import { Link } from "../router.tsx";
import { Alert, Badge, DemoBadge, Spinner, STATUS_LABEL } from "../ui.tsx";
import { CoverStudio } from "./cover.tsx";
import { ProjectProvider, useProject } from "./context.tsx";
import { ExportCenter } from "./export.tsx";
import { Overview } from "./overview.tsx";
import { PageStudio } from "./pages.tsx";
import { ProjectSettings } from "./settings.tsx";
import { StoryWorkspace } from "./story.tsx";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "story", label: "Story & characters", icon: BookOpen },
  { id: "pages", label: "Page studio", icon: Images },
  { id: "cover", label: "Cover", icon: Palette },
  { id: "export", label: "Export & validate", icon: FileCheck2 },
  { id: "settings", label: "Book settings", icon: Settings2 },
];

function Header({ tab }: { tab: string }) {
  const { data, activeJobs } = useProject();
  const p = data.project;
  const demo = data.pages.some((x) => x.asset?.isDemo) || data.coverArt?.is_demo || p.concept.provider === "demo";
  return (
    <>
      <div className="row between" style={{ marginBottom: 16, alignItems: "flex-start" }}>
        <div className="grow">
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <Link to="/dashboard" className="subtle">
              My books
            </Link>
            <span className="subtle">/</span>
            <Badge status={p.status}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
            {demo && <DemoBadge />}
          </div>
          <h1 style={{ marginBottom: 2 }}>{p.title || "Untitled book"}</h1>
          {p.subtitle && <p className="muted" style={{ margin: 0 }}>{p.subtitle}</p>}
        </div>
        {activeJobs.length > 0 && (
          <span className="badge running" style={{ padding: "6px 12px" }}>
            <Spinner size={13} /> {activeJobs.length} task{activeJobs.length === 1 ? "" : "s"} running
          </span>
        )}
      </div>
      <nav className="tabs" aria-label="Book sections">
        {TABS.map((t) => (
          <Link key={t.id} to={`/projects/${p.id}/${t.id}`} className={tab === t.id ? "active" : undefined} aria-current={tab === t.id ? "page" : undefined}>
            <t.icon size={16} /> {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

export function ProjectShell({ id, tab }: { id: string; tab: string }) {
  return (
    <div className="page">
      <ProjectProvider
        id={id}
        fallback={({ error }) =>
          error ? (
            <Alert kind="error">
              {error.status === 404 ? "This book doesn't exist or you don't have access to it." : error.message} <Link to="/dashboard">Back to my books</Link>
            </Alert>
          ) : (
            <div style={{ display: "grid", placeItems: "center", padding: 80 }}>
              <Spinner size={28} />
            </div>
          )
        }
      >
        <Header tab={tab} />
        {tab === "overview" && <Overview />}
        {tab === "story" && <StoryWorkspace />}
        {tab === "pages" && <PageStudio />}
        {tab === "cover" && <CoverStudio />}
        {tab === "export" && <ExportCenter />}
        {tab === "settings" && <ProjectSettings />}
      </ProjectProvider>
    </div>
  );
}
