import type { CoverLayout, Margins, Size } from "../../shared/kdp.ts";
import type { BookMetadata, BookSettings, CoverConfig, PageStatus, ProjectStatus, ValidationReport } from "../../shared/settings.ts";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface PublicConfig {
  allowRegistration: boolean;
  textProvider: { name: string; model: string; demo: boolean };
  imageProvider: { name: string; model: string; demo: boolean; supportsReferences: boolean };
  limits: { monthlyImageQuota: number; monthlyTextQuota: number; batchConfirmUsd: number; batchConfirmImages: number; maxUploadMb: number };
  imageCostUsd: { draft: number; standard: number; high: number };
}

export interface QualityCheck {
  id: string;
  status: "pass" | "warning" | "error";
  message: string;
}

export interface Page {
  id: string;
  position: number;
  storyIndex: number | null;
  sceneTitle: string;
  storyText: string;
  sceneDescription: string;
  activity: string;
  characters: string[];
  illustrationPrompt: string;
  promptEdited: boolean;
  status: PageStatus;
  locked: boolean;
  quality: { status: string; checks: QualityCheck[]; inkCoverage: number } | null;
  generationCount: number;
  lastError: string | null;
  asset: { id: string; isDemo: boolean; width: number; height: number; provider: string } | null;
  updatedAt: string;
}

export interface Character {
  id: string;
  key: string;
  name: string;
  role: string;
  description: string;
  visualTraits: string;
  referenceAssetId: string | null;
  referenceApproved: boolean;
}

export interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  message: string;
  attempts: number;
  maxAttempts: number;
  error: { kind: string; message: string } | null;
  payload: Record<string, any>;
  result: any;
  createdAt: string;
  finishedAt: string | null;
}

export interface ExportRecord {
  id: string;
  status: "queued" | "building" | "blocked" | "ready_for_review" | "failed";
  includeImages: boolean;
  jobId: string | null;
  interiorAssetId: string | null;
  coverAssetId: string | null;
  packageAssetId: string | null;
  spec: { pageCount?: number; spineWidth?: number; coverWidth?: number; coverHeight?: number };
  report: ValidationReport | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  status: ProjectStatus;
  folder: string;
  settings: BookSettings;
  concept: { synopsis?: string; outline?: string[]; provider?: string; model?: string; issues?: Array<{ severity: string; message: string; page?: number }> };
  cover: CoverConfig;
  coverArtAssetId: string | null;
  metadata: BookMetadata;
  metadataApproved: boolean;
  updatedAt: string;
}

export interface ProjectDetail {
  project: Project;
  characters: Character[];
  pages: Page[];
  jobs: Job[];
  latestExport: ExportRecord | null;
  interior: { pageCount: number; pageSize: Size; margins: Margins; kinds: string[] };
  coverLayout: CoverLayout;
  coverArt: { is_demo: boolean; width: number; height: number } | null;
}

export interface ProjectSummary {
  id: string;
  title: string;
  subtitle: string;
  status: ProjectStatus;
  folder: string;
  mode: string;
  trimSize: string;
  pageCount: number;
  illustrated: number;
  approved: number;
  thumbnailAssetId: string | null;
  thumbnailIsDemo: boolean;
  updatedAt: string;
}
