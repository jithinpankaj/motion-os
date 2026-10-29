-- MOTION OS — PostgreSQL schema (Part 13).
-- Large media lives in object storage; rows hold storage keys + metadata only.
-- Every tenant table carries workspace_id and every route filters on it.

-- ─── Identity ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,                       -- sha-256 of the bearer token; raw token never stored
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip text,
  user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- Development mail sink: outgoing mail is recorded here instead of being sent.
CREATE TABLE IF NOT EXISTS dev_mailbox (
  id bigserial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organisations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, slug)
);

CREATE TABLE IF NOT EXISTS permissions (
  key text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,   -- NULL = system role template
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_ws_key ON roles (coalesce(workspace_id, ''), key);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user ON workspace_memberships (user_id);

CREATE TABLE IF NOT EXISTS membership_roles (
  membership_id text NOT NULL REFERENCES workspace_memberships(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, role_id)
);

CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS team_memberships (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role_keys text[] NOT NULL,
  team_ids text[] NOT NULL DEFAULT '{}',
  token_hash text NOT NULL UNIQUE,
  invited_by text REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Brand ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  token_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS brand_tokens (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  category text NOT NULL,
  value jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, key)
);

CREATE TABLE IF NOT EXISTS token_versions (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, version)
);

CREATE TABLE IF NOT EXISTS brand_rules (
  id text PRIMARY KEY,
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL DEFAULT ''
);

-- ─── Assets (declared before brand_assets / motion references) ────────────
CREATE TABLE IF NOT EXISTS media_assets (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id text REFERENCES brands(id) ON DELETE SET NULL,
  team_id text REFERENCES teams(id) ON DELETE SET NULL,
  campaign_id text,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'svg', 'logo', 'font', 'motion', 'export')),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  tags text[] NOT NULL DEFAULT '{}',
  current_version_id text,
  license jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS media_assets_ws ON media_assets (workspace_id, kind) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset_versions (
  id text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version int NOT NULL,
  storage_key text NOT NULL,
  mime text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  width int,
  height int,
  sha256 text NOT NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, version)
);

CREATE TABLE IF NOT EXISTS asset_references (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  asset_version_id text REFERENCES asset_versions(id) ON DELETE RESTRICT,   -- set when pinned
  ref_type text NOT NULL CHECK (ref_type IN ('scene', 'template_version', 'variation', 'export', 'brand')),
  ref_id text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS asset_refs_ref ON asset_references (ref_type, ref_id);

CREATE TABLE IF NOT EXISTS asset_collections (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asset_collection_items (
  collection_id text NOT NULL REFERENCES asset_collections(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, asset_id)
);

CREATE TABLE IF NOT EXISTS brand_assets (
  brand_id text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'image',
  PRIMARY KEY (brand_id, asset_id)
);

-- ─── Motion ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS motion_projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id text REFERENCES brands(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS projects_ws ON motion_projects (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS motion_scenes (
  id text PRIMARY KEY,
  project_id text NOT NULL UNIQUE REFERENCES motion_projects(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  doc jsonb NOT NULL,
  revision int NOT NULL DEFAULT 1,          -- optimistic concurrency token
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scene_versions (
  id text PRIMARY KEY,
  scene_id text NOT NULL REFERENCES motion_scenes(id) ON DELETE RESTRICT,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version int NOT NULL,
  branch text NOT NULL DEFAULT 'main',
  parent_version_id text REFERENCES scene_versions(id) ON DELETE SET NULL,
  doc jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id, version)
);

CREATE TABLE IF NOT EXISTS motion_families (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id text REFERENCES brands(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS motion_templates (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text REFERENCES motion_projects(id) ON DELETE SET NULL,
  family_id text REFERENCES motion_families(id) ON DELETE SET NULL,
  brand_id text REFERENCES brands(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'General',
  interaction text NOT NULL DEFAULT 'none',
  channels text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'published', 'deprecated', 'archived')),
  visible_team_ids text[] NOT NULL DEFAULT '{}',   -- empty = every team in the workspace
  published_version_id text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_ws ON motion_templates (workspace_id, status);

CREATE TABLE IF NOT EXISTS template_versions (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES motion_templates(id) ON DELETE RESTRICT,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version int NOT NULL,
  scene_version_id text NOT NULL REFERENCES scene_versions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('draft', 'review', 'approved', 'published', 'deprecated', 'archived', 'rejected')),
  changelog text NOT NULL DEFAULT '',
  asset_pins jsonb NOT NULL DEFAULT '{}'::jsonb,   -- assetId -> assetVersionId
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (template_id, version)
);

CREATE TABLE IF NOT EXISTS template_parameters (
  id text PRIMARY KEY,
  template_version_id text NOT NULL REFERENCES template_versions(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  definition jsonb NOT NULL,
  UNIQUE (template_version_id, key)
);

CREATE TABLE IF NOT EXISTS animation_presets (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  config jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS shader_presets (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  mode text NOT NULL,
  config jsonb NOT NULL
);

-- ─── Campaigns ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_presets (
  id text PRIMARY KEY,
  name text NOT NULL,
  platform text NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  safe_area jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id text REFERENCES brands(id) ON DELETE SET NULL,
  owner_id text REFERENCES users(id) ON DELETE SET NULL,
  family_id text REFERENCES motion_families(id) ON DELETE SET NULL,
  template_id text NOT NULL REFERENCES motion_templates(id) ON DELETE RESTRICT,
  template_version_id text NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  master_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'review', 'approved', 'rejected')),
  publishing_status text NOT NULL DEFAULT 'unpublished' CHECK (publishing_status IN ('unpublished', 'published', 'outdated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_ws ON campaigns (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_variations (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_preset_id text NOT NULL REFERENCES channel_presets(id),
  name text NOT NULL,
  published_snapshot jsonb,                   -- immutable {templateVersionId, values} at publication
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, channel_preset_id)
);

CREATE TABLE IF NOT EXISTS content_overrides (
  id text PRIMARY KEY,
  variation_id text NOT NULL REFERENCES campaign_variations(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  param_key text NOT NULL,
  value jsonb NOT NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variation_id, param_key)
);

-- ─── Governance ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_requests (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('template_version', 'campaign')),
  subject_id text NOT NULL,
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS approvals_ws ON approval_requests (workspace_id, status);

CREATE TABLE IF NOT EXISTS approval_decisions (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  decided_by text REFERENCES users(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_approvals (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  approval_request_id text NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_ws ON audit_events (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id bigserial PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  subject_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_ws ON usage_events (workspace_id, created_at DESC);

-- ─── Delivery ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  source jsonb NOT NULL,                    -- {kind: project|template|variation, id, versionId?}
  scene_version_id text REFERENCES scene_versions(id) ON DELETE SET NULL,
  scene_snapshot jsonb NOT NULL,            -- resolved, validated scene actually rendered
  format text NOT NULL,
  settings jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  progress real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  error jsonb,
  result_file_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS export_jobs_user ON export_jobs (workspace_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS exported_files (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES export_jobs(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  mime text NOT NULL,
  bytes bigint NOT NULL,
  filename text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS published_assets (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id text REFERENCES motion_templates(id) ON DELETE RESTRICT,
  template_version_id text REFERENCES template_versions(id) ON DELETE RESTRICT,
  variation_id text REFERENCES campaign_variations(id) ON DELETE SET NULL,
  kind text NOT NULL,
  config jsonb NOT NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('connected', 'expired', 'error', 'disconnected')),
  scopes text[] NOT NULL DEFAULT '{}',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_enc text,
  expires_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publication_jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id text NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  export_job_id text REFERENCES export_jobs(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'failed')),
  destination_ref text,
  error text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Connections for design import (Figma) and analytics (GA4, Meta, LinkedIn) share integration_connections.
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS checked_at timestamptz;

CREATE TABLE IF NOT EXISTS analytics_links (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES motion_projects(id) ON DELETE CASCADE,
  connection_id text NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ga4', 'instagram', 'facebook', 'linkedin')),
  ref text NOT NULL,
  label text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_links_ws ON analytics_links (workspace_id);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id text PRIMARY KEY,
  link_id text NOT NULL REFERENCES analytics_links(id) ON DELETE CASCADE,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  series jsonb NOT NULL DEFAULT '[]'::jsonb,
  series_label text,
  error text
);
CREATE INDEX IF NOT EXISTS analytics_snapshots_link ON analytics_snapshots (link_id, fetched_at DESC);

-- Which permission keys have been rolled out to a workspace's system roles (see ensureGlobals).
CREATE TABLE IF NOT EXISTS permission_rollouts (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

-- Settings from the simple Create flow, so a motion can be reopened there. recipe_revision is the
-- scene revision the recipe produced; a newer scene revision means it was edited in the advanced editor.
ALTER TABLE motion_projects ADD COLUMN IF NOT EXISTS recipe jsonb;
ALTER TABLE motion_projects ADD COLUMN IF NOT EXISTS recipe_revision integer;
