CREATE UNIQUE INDEX IF NOT EXISTS candidates_email_unique_idx ON candidates(lower(email));
