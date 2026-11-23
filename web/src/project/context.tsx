import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, get } from "../api.ts";
import type { ProjectDetail } from "../types.ts";

interface ProjectCtxValue {
  data: ProjectDetail;
  reload(): Promise<void>;
  /** Optimistically replace part of the detail (e.g. a saved page). */
  mutate(fn: (d: ProjectDetail) => ProjectDetail): void;
  activeJobs: ProjectDetail["jobs"];
}

const Ctx = createContext<ProjectCtxValue | null>(null);

export function useProject(): ProjectCtxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("ProjectProvider missing");
  return v;
}

/** Loads the project and keeps polling while background jobs are running. */
export function ProjectProvider({ id, children, fallback }: { id: string; children: ReactNode; fallback: (state: { error: ApiError | null }) => ReactNode }) {
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await get<ProjectDetail>(`/api/projects/${id}`));
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  const activeJobs = data?.jobs.filter((j) => j.status === "queued" || j.status === "running") ?? [];
  const exportBusy = data?.latestExport && ["queued", "building"].includes(data.latestExport.status);
  const polling = activeJobs.length > 0 || !!exportBusy || data?.project.status === "planning";
  useEffect(() => {
    if (!polling) return;
    timer.current = setTimeout(() => void reload(), 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [polling, data, reload]);

  if (!data) return <>{fallback({ error })}</>;
  return <Ctx.Provider value={{ data, reload, mutate: (fn) => setData((d) => (d ? fn(d) : d)), activeJobs }}>{children}</Ctx.Provider>;
}
