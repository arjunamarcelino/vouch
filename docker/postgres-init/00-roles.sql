-- Runs once on first Postgres init (docker-entrypoint-initdb.d). Creates the least-privilege
-- application role the manual constraint SQL (packages/db/prisma/manual/*.sql, run by db:constraints)
-- grants to. Review/local only — production uses a managed Postgres with real credentials.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vouch_app') THEN
    CREATE ROLE vouch_app LOGIN PASSWORD 'vouch_app';
  END IF;
END
$$;
GRANT ALL PRIVILEGES ON DATABASE vouch TO vouch_app;
