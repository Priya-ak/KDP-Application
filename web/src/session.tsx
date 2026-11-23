import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, post, setCsrf, setUnauthorizedHandler } from "./api.ts";
import { navigate } from "./router.tsx";
import type { PublicConfig, User } from "./types.ts";

interface SessionValue {
  user: User | null;
  config: PublicConfig | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, name: string): Promise<void>;
  signOut(): Promise<void>;
  setUser(u: User): void;
}

const SessionCtx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await get<{ user: User | null; csrf: string | null; config: PublicConfig }>("/api/auth/me");
      setUser(me.user);
      setCsrf(me.csrf);
      setConfig(me.config);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => {
      setUser(null);
      setCsrf(null);
      navigate("/login", true);
    });
  }, [refresh]);

  const value: SessionValue = {
    user,
    config,
    loading,
    async signIn(email, password) {
      const r = await post<{ user: User; csrf: string }>("/api/auth/login", { email, password });
      setCsrf(r.csrf);
      setUser(r.user);
    },
    async signUp(email, password, name) {
      const r = await post<{ user: User; csrf: string }>("/api/auth/register", { email, password, name });
      setCsrf(r.csrf);
      setUser(r.user);
    },
    async signOut() {
      await post("/api/auth/logout").catch(() => undefined);
      setCsrf(null);
      setUser(null);
      navigate("/");
    },
    setUser,
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionCtx);
  if (!v) throw new Error("SessionProvider missing");
  return v;
}
