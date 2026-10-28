-- =============================================================
-- Send-back-for-revision workflow for daily logs
-- =============================================================
-- Lets an ops_manager or ceo send an already-submitted daily log back to
-- its writer for revision. The writer can then only edit it through the
-- new revise/resubmit endpoints (gated on status = 'needs_revision') —
-- there is no general "edit my old log" path, so a writer can never
-- revise a submitted log on their own initiative. Every send-back,
-- field edit, and resubmission is recorded in daily_log_revisions for
-- a full audit trail: what changed, when, and by whom.
--
-- Safe to re-run (IF NOT EXISTS / backfill is idempotent).

ALTER TABLE daily_logs
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','submitted','needs_revision'));
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS revision_requested_by INTEGER REFERENCES users(id);
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS revision_requested_at TIMESTAMPTZ;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS revision_reason TEXT;

-- Backfill existing rows' status from the data that already determined
-- it (submitted_at), since this column didn't exist before.
UPDATE daily_logs SET status = 'submitted' WHERE submitted_at IS NOT NULL AND status = 'draft';

CREATE TABLE IF NOT EXISTS daily_log_revisions (
    id                  SERIAL PRIMARY KEY,
    log_id              INTEGER         NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
    entry_id            INTEGER         REFERENCES daily_log_entries(id) ON DELETE CASCADE,
    action              VARCHAR(20)     NOT NULL,
    actor_id            INTEGER         NOT NULL REFERENCES users(id),
    reason              TEXT,
    field_changes        JSONB,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_log_revisions_log ON daily_log_revisions(log_id);
