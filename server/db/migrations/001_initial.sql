-- AI Coloring Book Studio: initial schema.
-- Every project-owned row carries user_id so queries can enforce ownership
-- without joins; binaries live in object storage, only references live here.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- sha256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  folder TEXT NOT NULL DEFAULT '',
  settings JSONB NOT NULL,
  concept JSONB NOT NULL DEFAULT '{}'::jsonb,       -- synopsis, outline, tone, provider
  cover JSONB NOT NULL DEFAULT '{}'::jsonb,         -- cover configuration
  cover_art_asset_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,      -- KDP listing metadata
  metadata_approved BOOLEAN NOT NULL DEFAULT false,
  thumbnail_asset_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_idx ON projects(user_id, updated_at DESC);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- illustration | original | upload | cover_art | reference | interior_pdf | cover_pdf | package
  storage_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  provider TEXT NOT NULL,             -- demo | openai | upload | system
  is_demo BOOLEAN NOT NULL DEFAULT false,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assets_project_idx ON assets(project_id);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,                  -- stable slug used by pages, e.g. milo_rabbit
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  visual_traits TEXT NOT NULL DEFAULT '',   -- the fixed phrase repeated in prompts
  reference_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  reference_approved BOOLEAN NOT NULL DEFAULT false,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  story_index INTEGER,                -- original narrative order (story modes)
  kind TEXT NOT NULL DEFAULT 'content',
  scene_title TEXT NOT NULL DEFAULT '',
  story_text TEXT NOT NULL DEFAULT '',
  scene_description TEXT NOT NULL DEFAULT '',
  activity TEXT NOT NULL DEFAULT '',
  characters JSONB NOT NULL DEFAULT '[]'::jsonb,
  illustration_prompt TEXT NOT NULL DEFAULT '',
  prompt_edited BOOLEAN NOT NULL DEFAULT false,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  locked BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ,
  quality JSONB,
  generation_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pages_project_idx ON pages(project_id, position);

-- Snapshots for single-step undo of page edits.
CREATE TABLE page_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX page_versions_page_idx ON page_versions(page_id, created_at DESC);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | succeeded | failed | cancelled
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT UNIQUE,
  progress INTEGER NOT NULL DEFAULT 0,
  progress_message TEXT NOT NULL DEFAULT '',
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX jobs_queue_idx ON jobs(status, run_after);
CREATE INDEX jobs_project_idx ON jobs(project_id, created_at DESC);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | building | blocked | ready_for_review | failed
  include_images BOOLEAN NOT NULL DEFAULT false,
  interior_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  cover_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  package_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  report JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX exports_project_idx ON exports(project_id, created_at DESC);

CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  job_id TEXT,
  kind TEXT NOT NULL,                 -- text | image
  provider TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX usage_user_idx ON usage_records(user_id, created_at);
