CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  entity_type text,
  entity_id text,
  due_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS notifications_inbox_idx ON notifications(user_id,read_at,created_at DESC);
