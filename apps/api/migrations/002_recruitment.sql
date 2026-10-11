DO $$ BEGIN
  CREATE TYPE application_status AS ENUM ('ACTIVE', 'HIRED', 'REJECTED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE approval_decision AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_INFORMATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS candidates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  resume_url text,
  professional_url text,
  city text,
  state text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidates_email_idx ON candidates(lower(email));
CREATE INDEX IF NOT EXISTS candidates_name_idx ON candidates(full_name);

CREATE TABLE IF NOT EXISTS recruitment_stages (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  vacancy_id text NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  position integer NOT NULL CHECK (position >= 0),
  due_days integer CHECK (due_days IS NULL OR due_days > 0),
  requires_approval boolean NOT NULL DEFAULT false,
  approval_mode text CHECK (approval_mode IS NULL OR approval_mode IN ('ALL', 'MAJORITY', 'ANY')),
  allow_manual_transition boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, position)
);
CREATE INDEX IF NOT EXISTS stages_vacancy_order_idx ON recruitment_stages(vacancy_id, active, position);

CREATE TABLE IF NOT EXISTS applications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  candidate_id text NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  vacancy_id text NOT NULL REFERENCES vacancies(id) ON DELETE RESTRICT,
  current_stage_id text REFERENCES recruitment_stages(id) ON DELETE SET NULL,
  status application_status NOT NULL DEFAULT 'ACTIVE',
  applied_at timestamptz NOT NULL DEFAULT now(),
  last_moved_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closure_kind text CHECK (closure_kind IS NULL OR closure_kind IN ('REJECTION', 'WITHDRAWAL', 'HIRED')),
  closure_reason text,
  closure_comment text,
  salary_expectation numeric(12,2) CHECK (salary_expectation IS NULL OR salary_expectation >= 0),
  UNIQUE (candidate_id, vacancy_id)
);
CREATE INDEX IF NOT EXISTS applications_vacancy_status_stage_idx ON applications(vacancy_id, status, current_stage_id);
CREATE INDEX IF NOT EXISTS applications_status_last_moved_idx ON applications(status, last_moved_at);

CREATE TABLE IF NOT EXISTS stage_approvers (
  stage_id text NOT NULL REFERENCES recruitment_stages(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  required boolean NOT NULL DEFAULT true,
  PRIMARY KEY (stage_id, user_id)
);

CREATE TABLE IF NOT EXISTS stage_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id text NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  from_stage_id text REFERENCES recruitment_stages(id) ON DELETE SET NULL,
  to_stage_id text REFERENCES recruitment_stages(id) ON DELETE SET NULL,
  actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entered_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transitions_application_time_idx ON stage_transitions(application_id, entered_at);
CREATE INDEX IF NOT EXISTS transitions_stage_time_idx ON stage_transitions(to_stage_id, entered_at);

CREATE TABLE IF NOT EXISTS approval_records (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  application_id text NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  stage_id text NOT NULL REFERENCES recruitment_stages(id) ON DELETE RESTRICT,
  approver_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision approval_decision NOT NULL DEFAULT 'PENDING',
  comment text,
  due_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_assignee_state_due_idx ON approval_records(approver_id, decision, due_at);
CREATE INDEX IF NOT EXISTS approvals_application_stage_idx ON approval_records(application_id, stage_id, created_at);

CREATE TABLE IF NOT EXISTS closure_reasons (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind text NOT NULL CHECK (kind IN ('REJECTION', 'WITHDRAWAL')),
  label text NOT NULL,
  requires_note boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (kind, label)
);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS closure_reason_id text REFERENCES closure_reasons(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS candidate_notes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  application_id text NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  author_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL,
  confidential boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_application_time_idx ON candidate_notes(application_id, created_at);

CREATE TABLE IF NOT EXISTS candidate_activities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  application_id text NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  title text NOT NULL,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_application_due_idx ON candidate_activities(application_id, due_at);

INSERT INTO closure_reasons (kind, label, requires_note) VALUES
 ('REJECTION', 'Conhecimento técnico insuficiente', false),
 ('REJECTION', 'Experiência incompatível com a vaga', false),
 ('REJECTION', 'Requisitos obrigatórios não atendidos', false),
 ('REJECTION', 'Resultado insatisfatório na entrevista', false),
 ('REJECTION', 'Expectativa salarial incompatível', false),
 ('REJECTION', 'Outro motivo', true),
 ('WITHDRAWAL', 'Aceitou outra proposta', false),
 ('WITHDRAWAL', 'Desistiu do processo seletivo', false),
 ('WITHDRAWAL', 'Não respondeu aos contatos', false),
 ('WITHDRAWAL', 'Incompatibilidade salarial', false),
 ('WITHDRAWAL', 'Outro motivo', true)
ON CONFLICT (kind, label) DO NOTHING;
