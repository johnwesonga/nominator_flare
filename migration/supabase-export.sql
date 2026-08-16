-- Run from psql with a direct Supabase PostgreSQL connection.
-- Invoke from the repository root so files land in migration/input/:
--   psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f migration/supabase-export.sql
--
-- This script is read-only. Do not commit the generated CSV files.

\copy (SELECT id, email, family_token, created_at FROM public.families ORDER BY id) TO 'migration/input/families.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT id, family_id, name, group_name, has_voted, created_at FROM public.swimmers ORDER BY id) TO 'migration/input/swimmers.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT id, voter_id, candidate_id, created_at FROM public.votes ORDER BY id) TO 'migration/input/votes.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT id, is_open, closed_at FROM public.voting_settings ORDER BY id) TO 'migration/input/voting_settings.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT lower(u.email) AS email, u.created_at FROM public.admins a JOIN auth.users u ON u.id = a.user_id WHERE u.email IS NOT NULL ORDER BY lower(u.email)) TO 'migration/input/admins.csv' WITH (FORMAT csv, HEADER true)
