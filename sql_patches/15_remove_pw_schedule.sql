-- =============================================================
-- Remove Patricia's standing schedule-override feature
--
-- This was a one-off hardcoded tab (GET/PATCH /hr/schedule/pw) showing
-- Patricia Walker's 4-day-week day-off overrides. It kept showing
-- regardless of whether her account was active or deactivated, and had
-- no other consumer in the app — removed entirely (app code + this
-- table) rather than patched in place.
--
-- Usage:
--   docker cp 15_remove_pw_schedule.sql labpm_db:/15.sql
--   docker compose exec db psql -U labpm_user labpm -f /15.sql
-- =============================================================

\echo 'Removing work_schedule_overrides...'
DROP TABLE IF EXISTS work_schedule_overrides;
\echo 'work_schedule_overrides removed.'
