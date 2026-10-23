-- Lean blueprints: schema. Safe to run more than once.

-- One row per private link. A link points at one blueprint (slug) and is
-- labelled with who it was sent to. kind = 'internal' for Lean teammates,
-- so their visits never count as client views.
CREATE TABLE IF NOT EXISTS links (
  token       TEXT PRIMARY KEY,
  slug        TEXT NOT NULL,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'client' CHECK (kind IN ('client', 'internal')),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS links_slug_idx ON links (slug);

-- One row per visit (a page load that stayed visible for about 10 seconds).
CREATE TABLE IF NOT EXISTS views (
  id               BIGSERIAL PRIMARY KEY,
  session_id       TEXT NOT NULL UNIQUE,
  token            TEXT NOT NULL REFERENCES links (token),
  slug             TEXT NOT NULL,
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  seconds_visible  INTEGER NOT NULL DEFAULT 0,
  user_agent       TEXT,
  country          TEXT
);
CREATE INDEX IF NOT EXISTS views_token_idx ON views (token, opened_at DESC);
CREATE INDEX IF NOT EXISTS views_slug_idx ON views (slug, opened_at DESC);

-- Who viewed: the work email entered once per browser on a client link. Lean emails are 'lean' and
-- don't count as the client team's visits. Not verified.
ALTER TABLE views ADD COLUMN IF NOT EXISTS viewer_email TEXT;
ALTER TABLE views ADD COLUMN IF NOT EXISTS viewer_name TEXT;
ALTER TABLE views ADD COLUMN IF NOT EXISTS viewer_kind TEXT;

-- Checklist state, one row per blueprint item.
CREATE TABLE IF NOT EXISTS checklist (
  slug        TEXT NOT NULL,
  item        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (slug, item)
);

-- Uploaded blueprints. One row per client blueprint; re-uploading replaces the file.
CREATE TABLE IF NOT EXISTS blueprints (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  html         TEXT NOT NULL,
  items        TEXT[] NOT NULL DEFAULT '{}',
  size_bytes   INTEGER NOT NULL,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Blueprints built in the admin form: the form content is kept as a draft, and
-- publishing renders it into html. Uploaded blueprints leave these columns empty.
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS draft JSONB;
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE blueprints ALTER COLUMN html DROP NOT NULL;
ALTER TABLE blueprints ALTER COLUMN size_bytes DROP NOT NULL;

-- Checklist state per client team (one link = one team). Replaces the per-blueprint
-- "checklist" table, which is left in place but no longer used.
CREATE TABLE IF NOT EXISTS team_checklist (
  token       TEXT NOT NULL REFERENCES links (token),
  item        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token, item)
);

-- Display name in the admin page: the client's name (e.g. "Wise").
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS name TEXT;
UPDATE blueprints SET name = nullif(trim(draft -> 'client' ->> 'name'), '') WHERE name IS NULL AND source = 'builder';
UPDATE blueprints SET name = regexp_replace(title, '\s+([A-Z]{2,4}\s+)?Integration Blueprint.*$', '') WHERE name IS NULL;

-- Phases and guide checklists read from the published page, for the admin progress breakdown.
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS structure JSONB;

-- Vertical presets: each vertical's pain points, introduction and use cases, maintained in the admin page.
CREATE TABLE IF NOT EXISTS verticals (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  pain_intro  TEXT NOT NULL DEFAULT '',
  pain_rows   JSONB NOT NULL DEFAULT '[]',
  use_cases   JSONB NOT NULL DEFAULT '[]',
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The client team's environment, set by Lean: 'sandbox' until Lean upgrades them, then 'production'.
ALTER TABLE links ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE links ADD COLUMN IF NOT EXISTS environment_changed_at TIMESTAMPTZ;

-- A client team's request for production access, sent from their blueprint (Lean grants it by setting the environment).
ALTER TABLE links ADD COLUMN IF NOT EXISTS production_requested_at TIMESTAMPTZ;
ALTER TABLE links ADD COLUMN IF NOT EXISTS production_request_note TEXT;

-- The client team's email domains, set by Lean per client link. Only these emails count as the client team.
ALTER TABLE links ADD COLUMN IF NOT EXISTS client_domains TEXT[];
ALTER TABLE links ADD COLUMN IF NOT EXISTS production_requested_by TEXT;
-- Who ticked or unticked each item.
ALTER TABLE team_checklist ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Production access requests from client teams: the demo recording (or why it doesn't apply) and the
-- production Settlement Account details. The latest one per link is shown in the admin page.
CREATE TABLE IF NOT EXISTS production_requests (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES links(token) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by TEXT,
  note TEXT,
  video_url TEXT, video_name TEXT, video_bytes BIGINT,
  video_na_reason TEXT,
  account_holder_name TEXT NOT NULL,
  trade_license_number TEXT NOT NULL,
  iban TEXT NOT NULL,
  account_number TEXT NOT NULL,
  bank_address TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS production_requests_token_idx ON production_requests (token, created_at DESC);
-- Who's emailed when a client team requests production access (falls back to NOTIFY_EMAIL).
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS notify_email TEXT;

-- Every recording upload, so the free plan's 1 GB Blob storage is never exceeded (Blob is switched off for
-- 30 days if it is). A row is reserved before an upload token is issued, stored when the upload completes,
-- and deleted when the recording is replaced, cleaned up or deleted by Lean.
CREATE TABLE IF NOT EXISTS blob_uploads (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL REFERENCES links(token) ON DELETE CASCADE,
  pathname TEXT,
  url TEXT UNIQUE,
  bytes BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS blob_uploads_token_idx ON blob_uploads (token);
ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS video_deleted_at TIMESTAMPTZ;

-- Earlier versions of each blueprint, kept before every Replace file, publish, restore and conversion to the
-- form, so any of them can be viewed, downloaded or restored. The latest 20 per blueprint are kept.
CREATE TABLE IF NOT EXISTS blueprint_versions (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES blueprints(slug) ON DELETE CASCADE,
  html TEXT NOT NULL,
  draft JSONB,
  source TEXT,
  size_bytes INTEGER,
  reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blueprint_versions_slug_idx ON blueprint_versions (slug, created_at DESC);

-- Lean-only review comments on a blueprint (never shown to clients): threads anchored to a passage or block
-- on the page, with replies, resolve and reopen.
CREATE TABLE IF NOT EXISTS comment_threads (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES blueprints(slug) ON DELETE CASCADE,
  anchor JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comment_threads_slug_idx ON comment_threads (slug, created_at);
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  author_name TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comments_thread_idx ON comments (thread_id, created_at);

-- Who owns each blueprint: the Lean person who created it. Production requests and review comments are emailed
-- to the owner, plus anyone in notify_email ("Also notify").
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS owner_name TEXT;
