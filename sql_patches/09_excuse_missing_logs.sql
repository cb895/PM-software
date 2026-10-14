-- =============================================================
-- Let the ops manager excuse a flagged missing log
-- =============================================================
-- missing_log_flags already had a `resolved` column, but nothing in the
-- app ever set it — once the cron job flagged a day, it stayed flagged
-- forever with no way to clear it. Adds an audit trail (who excused it,
-- and why) for the new POST /daily-logs/missing/{flag_id}/excuse endpoint.
--
-- Safe to re-run (uses IF NOT EXISTS).

ALTER TABLE missing_log_flags ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id);
ALTER TABLE missing_log_flags ADD COLUMN IF NOT EXISTS resolve_reason TEXT;
