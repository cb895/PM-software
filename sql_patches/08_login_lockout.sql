-- =============================================================
-- Brute-force login protection — adds account lockout tracking
-- =============================================================
-- POST /auth/token had no rate limiting or lockout at all: an attacker
-- could try unlimited passwords against any known employee email with
-- no throttling. Adds two columns the backend now uses to lock an
-- account for 15 minutes after 5 consecutive failed attempts.
--
-- Safe to re-run (uses IF NOT EXISTS).

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
