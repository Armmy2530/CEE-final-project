-- Club Dashboard (Clubhouse) v2 Schema for Supabase PostgreSQL
CREATE SCHEMA IF NOT EXISTS "public-cee-v2";

CREATE TABLE IF NOT EXISTS "public-cee-v2".users (
  member_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  pw_hash TEXT,
  pw_salt TEXT,
  theme TEXT DEFAULT 'dark' CHECK (theme IN ('light', 'dark')),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "public-cee-v2".sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES "public-cee-v2".users(member_id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cee_v2_sessions_member ON "public-cee-v2".sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_cee_v2_sessions_expires ON "public-cee-v2".sessions(expires_at);

CREATE TABLE IF NOT EXISTS "public-cee-v2".app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Grant permissions to Supabase API roles
GRANT USAGE ON SCHEMA "public-cee-v2" TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA "public-cee-v2" TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public-cee-v2" GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- Expose "public-cee-v2" schema to PostgREST automatically
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, storage, graphql_public, public-cee-v2';
NOTIFY pgrst, 'reload config';
