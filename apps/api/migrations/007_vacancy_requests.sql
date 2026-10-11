ALTER TABLE users
  ADD COLUMN IF NOT EXISTS supervisor_id text REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_recruiter_id text REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS opening_type text CHECK (opening_type IS NULL OR opening_type IN ('NEW_POSITION','REPLACEMENT')),
  ADD COLUMN IF NOT EXISTS seniority_level text;

CREATE TABLE IF NOT EXISTS vacancy_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hiring_manager_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recruiter_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL,
  opening_type text NOT NULL CHECK (opening_type IN ('NEW_POSITION','REPLACEMENT')),
  description text NOT NULL,
  technical_requirements text NOT NULL,
  seniority_level text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_RECRUITER'
    CHECK (status IN ('PENDING_RECRUITER','RETURNED','APPROVED')),
  review_note text,
  reviewer_id text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  result_vacancy_id text REFERENCES vacancies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vacancy_requests_recruiter_status_idx ON vacancy_requests(recruiter_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS vacancy_requests_manager_time_idx ON vacancy_requests(hiring_manager_id,created_at DESC);
CREATE INDEX IF NOT EXISTS vacancy_requests_creator_time_idx ON vacancy_requests(created_by,created_at DESC);
DROP TRIGGER IF EXISTS vacancy_requests_updated_at ON vacancy_requests;
CREATE TRIGGER vacancy_requests_updated_at BEFORE UPDATE ON vacancy_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
