import { useEffect, useState } from "react";
import { get, patch, post } from "../api.ts";
import { useSession } from "../session.tsx";
import { Alert, Badge, Field, ProgressBar, Spinner, useAction } from "../ui.tsx";

interface Usage {
  periodStart: string;
  images: number;
  textCalls: number;
  costUsd: number;
  imageQuota: number;
  textQuota: number;
}

export function AccountPage() {
  const { user, config, setUser } = useSession();
  const { busy, run } = useAction();
  const [name, setName] = useState(user?.name ?? "");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    get<Usage>("/api/usage").then(setUsage).catch(() => undefined);
  }, []);

  return (
    <div className="page narrow stack" style={{ gap: 20 }}>
      <h1>Account & settings</h1>
      <div className="card stack">
        <h3>Profile</h3>
        <div className="grid-2">
          <Field label="Email">
            <input className="input" value={user?.email ?? ""} disabled />
          </Field>
          <Field label="Name" htmlFor="name">
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div>
          <button className="btn primary" disabled={busy === "profile"} onClick={() => run("profile", async () => setUser((await patch("/api/account", { name })).user), "Profile saved")}>
            Save profile
          </button>
        </div>
      </div>

      <div className="card stack">
        <h3>Change password</h3>
        <div className="grid-2">
          <Field label="Current password" htmlFor="cpw">
            <input id="cpw" className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password" htmlFor="npw" hint="At least 10 characters. Other sessions will be signed out.">
            <input id="npw" className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
        </div>
        <div>
          <button className="btn" disabled={busy === "pw" || !pw.currentPassword || pw.newPassword.length < 10} onClick={() => run("pw", async () => { await post("/api/account/password", pw); setPw({ currentPassword: "", newPassword: "" }); }, "Password changed")}>
            Change password
          </button>
        </div>
      </div>

      <div className="card stack">
        <h3>Usage this month</h3>
        {!usage ? (
          <Spinner />
        ) : (
          <>
            <div className="grid-3">
              <div className="stat"><b>{usage.images}</b><span className="subtle">of {usage.imageQuota} images</span></div>
              <div className="stat"><b>{usage.textCalls}</b><span className="subtle">of {usage.textQuota} writing runs</span></div>
              <div className="stat"><b>${usage.costUsd.toFixed(2)}</b><span className="subtle">estimated provider cost</span></div>
            </div>
            <ProgressBar value={(usage.images / Math.max(1, usage.imageQuota)) * 100} />
            <p className="subtle" style={{ margin: 0 }}>Costs are estimates from configured provider prices; your provider's bill is authoritative. Quotas reset on the 1st (UTC).</p>
          </>
        )}
      </div>

      <div className="card stack">
        <h3>AI providers</h3>
        {config && (
          <table className="simple">
            <thead>
              <tr><th>Purpose</th><th>Provider</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Story, plan & listing text</td>
                <td className="mono">{config.textProvider.demo ? "demo template writer" : `${config.textProvider.name} · ${config.textProvider.model}`}</td>
                <td>{config.textProvider.demo ? <Badge status="demo">Demo</Badge> : <Badge status="pass">Connected</Badge>}</td>
              </tr>
              <tr>
                <td>Illustrations & cover art</td>
                <td className="mono">{config.imageProvider.demo ? "procedural placeholder renderer" : `${config.imageProvider.name} · ${config.imageProvider.model}`}</td>
                <td>{config.imageProvider.demo ? <Badge status="demo">Demo</Badge> : <Badge status="pass">Connected</Badge>}</td>
              </tr>
            </tbody>
          </table>
        )}
        <Alert kind="info">
          API keys live only on the server and are never sent to the browser. To enable real generation, set <span className="mono">ANTHROPIC_API_KEY</span> or the free <span className="mono">GROQ_API_KEY</span> (story & listing text) and <span className="mono">OPENAI_API_KEY</span> (illustrations; Groq has no image models) in the server's <span className="mono">.env</span> and restart. Optional: <span className="mono">ANTHROPIC_MODEL</span>, <span className="mono">OPENAI_IMAGE_MODEL</span>, <span className="mono">IMAGE_COST_*_USD</span>, <span className="mono">MONTHLY_IMAGE_QUOTA</span>, <span className="mono">BATCH_CONFIRM_USD</span>.
        </Alert>
      </div>
    </div>
  );
}
