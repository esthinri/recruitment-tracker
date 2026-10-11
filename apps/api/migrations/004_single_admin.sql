CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin_idx ON users(role) WHERE role='ADMIN';
