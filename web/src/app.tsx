import { LogOut, Palette, UserRound } from "lucide-react";
import { useEffect } from "react";
import { AccountPage } from "./pages/account.tsx";
import { AuthPage } from "./pages/auth.tsx";
import { Dashboard } from "./pages/dashboard.tsx";
import { Landing } from "./pages/landing.tsx";
import { NewBookWizard } from "./pages/new-book.tsx";
import { ProjectShell } from "./project/shell.tsx";
import { Link, match, navigate, usePath } from "./router.tsx";
import { useSession } from "./session.tsx";
import { Spinner } from "./ui.tsx";

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <Palette size={size * 0.55} />
    </span>
  );
}

function TopBar() {
  const { user, signOut } = useSession();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to={user ? "/dashboard" : "/"} className="brand">
          <BrandMark /> <span className="brand-text">Coloring Book Studio</span>
        </Link>
        {user && (
          <nav className="nav" aria-label="Main">
            <Link to="/dashboard" activeClass="active">
              My books
            </Link>
            <Link to="/new" activeClass="active">
              New book
            </Link>
          </nav>
        )}
        <div className="grow" />
        {user ? (
          <div className="row">
            <Link to="/account" className="btn ghost sm" activeClass="active">
              <UserRound size={16} /> <span className="hide-sm">{user.name || user.email}</span>
            </Link>
            <button className="btn ghost sm" onClick={() => void signOut()} aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <div className="row">
            <Link to="/login" className="btn ghost sm">
              Sign in
            </Link>
            <Link to="/signup" className="btn primary sm">
              Start a book
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  useEffect(() => {
    if (!user) navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`, true);
  }, [user]);
  return user ? <>{children}</> : null;
}

export function App() {
  const path = usePath();
  const { loading, user } = useSession();
  if (loading)
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <Spinner size={28} />
      </div>
    );
  let content: React.ReactNode;
  let m: Record<string, string> | null;
  if (path === "/") content = <Landing />;
  else if (path === "/login") content = <AuthPage mode="login" />;
  else if (path === "/signup") content = <AuthPage mode="signup" />;
  else if (path === "/dashboard") content = <Protected><Dashboard /></Protected>;
  else if (path === "/new") content = <Protected><NewBookWizard /></Protected>;
  else if (path === "/account") content = <Protected><AccountPage /></Protected>;
  else if ((m = match("/projects/:id", path)) || (m = match("/projects/:id/:tab", path))) content = <Protected><ProjectShell id={m.id!} tab={m.tab ?? "overview"} /></Protected>;
  else
    content = (
      <div className="page narrow">
        <h1>Page not found</h1>
        <Link to={user ? "/dashboard" : "/"}>Go home</Link>
      </div>
    );
  return (
    <>
      <TopBar />
      <main>{content}</main>
    </>
  );
}
