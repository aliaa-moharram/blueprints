-- Lean blueprints: the same schema as schema.sql, wrapped in one command
-- for SQL editors that run a single command at a time. Safe to run more than once.
DO $$
BEGIN
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

  CREATE TABLE IF NOT EXISTS checklist (
    slug        TEXT NOT NULL,
    item        TEXT NOT NULL,
    done        BOOLEAN NOT NULL DEFAULT false,
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (slug, item)
  );

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

  -- Blueprints built in the admin form (added in the builder update).
  ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';
  ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS draft JSONB;
  ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;
  ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
  ALTER TABLE blueprints ALTER COLUMN html DROP NOT NULL;
  ALTER TABLE blueprints ALTER COLUMN size_bytes DROP NOT NULL;

  -- Checklist state per client team (added in the team update).
  CREATE TABLE IF NOT EXISTS team_checklist (
    token       TEXT NOT NULL REFERENCES links (token),
    item        TEXT NOT NULL,
    done        BOOLEAN NOT NULL DEFAULT false,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (token, item)
  );
END
$$;
