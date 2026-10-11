ALTER TABLE recruitment_stages DROP CONSTRAINT IF EXISTS recruitment_stages_vacancy_id_position_key;
CREATE UNIQUE INDEX IF NOT EXISTS stages_active_position_unique_idx
  ON recruitment_stages(vacancy_id,position) WHERE active=true;
