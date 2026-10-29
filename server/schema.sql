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

-- Connections for design import (Figma) and analytics (GA4, Meta, LinkedIn) share integration_connections.
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS checked_at timestamptz;

-- Which permission keys have been rolled out to a workspace's system roles (see ensureGlobals).
CREATE TABLE IF NOT EXISTS permission_rollouts (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  PRIMARY KEY (workspace_id, key)
);


-- Community: a shared gallery across every workspace on this server. A post is an immutable copy of a
-- motion (its assets are copied into community storage), so remixes never reach back into the source
-- workspace. Unpublishing hides a post; remixes already made are unaffected.
CREATE TABLE IF NOT EXISTS community_posts (
  id text PRIMARY KEY,
  project_id text REFERENCES motion_projects(id) ON DELETE SET NULL,
  workspace_id text REFERENCES workspaces(id) ON DELETE SET NULL,
  author_id text REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  doc jsonb NOT NULL,
  is_preset boolean NOT NULL DEFAULT false,
  preset_key text UNIQUE,
  remix_of text REFERENCES community_posts(id) ON DELETE SET NULL,
  remix_count integer NOT NULL DEFAULT 0,
  like_count integer NOT NULL DEFAULT 0,
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  unpublished_at timestamptz
);
CREATE INDEX IF NOT EXISTS community_posts_recent ON community_posts (published_at DESC) WHERE unpublished_at IS NULL;

CREATE TABLE IF NOT EXISTS community_assets (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  mime text NOT NULL,
  width integer,
  height integer,
  bytes bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS community_likes (
  post_id text NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE motion_projects ADD COLUMN IF NOT EXISTS remix_of text;

-- Sounds can be uploaded as assets (rules play them).
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_kind_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_kind_check CHECK (kind IN ('image', 'video', 'svg', 'logo', 'font', 'motion', 'export', 'audio'));
