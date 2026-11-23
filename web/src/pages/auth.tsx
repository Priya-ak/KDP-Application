import { useState, type FormEvent } from "react";
import { BrandMark } from "../app.tsx";
import { Link, navigate } from "../router.tsx";
import { useSession } from "../session.tsx";
import { Alert, Field, Spinner } from "../ui.tsx";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { signIn, signUp, config, user } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(window.location.search).get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : mode === "signup" ? "/new" : "/dashboard";

  if (user) {
    queueMicrotask(() => navigate(target, true));
    return null;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await signIn(email, password);
      else await signUp(email, password, name);
      navigate(target, true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 440, paddingTop: 60 }}>
      <div className="card" style={{ padding: 30 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <BrandMark size={46} />
          <h1 style={{ marginTop: 14, fontSize: "1.7rem" }}>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="muted">{mode === "login" ? "Sign in to continue your books." : "Start making print-ready coloring books."}</p>
        </div>
        {mode === "signup" && config && !config.allowRegistration ? (
          <Alert kind="warn">Registration is turned off on this server.</Alert>
        ) : (
          <form className="stack" onSubmit={submit} noValidate>
            {mode === "signup" && (
              <Field label="Your name" htmlFor="name">
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
            )}
            <Field label="Email" htmlFor="email">
              <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </Field>
            <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 10 characters." : undefined}>
              <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
            </Field>
            {error && <Alert kind="error">{error}</Alert>}
            <button className="btn primary lg" disabled={busy || !email || !password}>
              {busy && <Spinner size={16} />} {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        )}
        <p className="muted" style={{ textAlign: "center", marginTop: 18, marginBottom: 0 }}>
          {mode === "login" ? (
            <>
              New here? <Link to="/signup">Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to="/login">Sign in</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
