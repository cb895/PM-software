-- =============================================================
-- Fix script — run this if users are missing or named incorrectly
-- Connects to your running labpm DB:
--   docker compose exec db psql -U labpm_user labpm -f /fix_users.sql
-- Or paste directly into the DB shell
-- =============================================================

-- Upsert all 6 user accounts with correct names, roles, and password
INSERT INTO users (full_name, email, hashed_password, role, is_active) VALUES
    ('Chris Bagley',    'cb@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'ops_manager', TRUE),
    ('Kevin Jones',     'kj@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'ceo',         TRUE),
    ('Kaytlyn Crowe',   'kc@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'qm_director', TRUE),
    ('Andrew Dimis',    'ad@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'lab_tech',    TRUE),
    ('Patricia Walker', 'pw@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'lab_tech',    TRUE),
    ('Emma Claire',     'el@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'lab_tech',    TRUE)
ON CONFLICT (email) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        role      = EXCLUDED.role,
        is_active = EXCLUDED.is_active,
        hashed_password = EXCLUDED.hashed_password;

-- Verify
SELECT id, full_name, email, role, is_active FROM users ORDER BY id;

-- Verify
SELECT id, full_name, email, role, is_active FROM users ORDER BY id;
