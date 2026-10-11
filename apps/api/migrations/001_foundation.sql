DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('ADMIN', 'HIRING_MANAGER', 'RECRUITER', 'APPROVER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vacancy_status AS ENUM ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  google_subject text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role user_role NOT NULL DEFAULT 'RECRUITER',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_role_active_idx ON users(role, active);

CREATE TABLE IF NOT EXISTS departments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vacancies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  requirements text NOT NULL,
  department_id text REFERENCES departments(id) ON DELETE SET NULL,
  hiring_manager_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recruiter_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  openings integer NOT NULL DEFAULT 1 CHECK (openings > 0),
  city text,
  state text,
  country text NOT NULL DEFAULT 'Brasil',
  work_model text,
  employment_type text,
  priority integer NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status vacancy_status NOT NULL DEFAULT 'DRAFT',
  opened_at timestamptz,
  target_close_at timestamptz,
  closed_at timestamptz,
  closure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vacancies_status_deadline_idx ON vacancies(status, target_close_at);
CREATE INDEX IF NOT EXISTS vacancies_manager_status_idx ON vacancies(hiring_manager_id, status);
CREATE INDEX IF NOT EXISTS vacancies_recruiter_status_idx ON vacancies(recruiter_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_entity_time_idx ON audit_logs(entity_type, entity_id, created_at);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS vacancies_updated_at ON vacancies;
CREATE TRIGGER vacancies_updated_at BEFORE UPDATE ON vacancies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
