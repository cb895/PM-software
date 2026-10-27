-- =============================================================
-- Student intern presence tracking (separate from daily_logs)
-- =============================================================
-- Interns just need their hours and a one-line summary tracked — no
-- project, no task, no consumable usage, and none of it should feed the
-- weekly report or budget. Deliberately a new standalone table rather
-- than reusing daily_logs, which is wired into all of that.
--
-- ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction
-- block together with its own use, but this file has no surrounding
-- BEGIN/COMMIT, so it's safe to run as-is. Safe to re-run (IF NOT EXISTS).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'intern';

CREATE TABLE IF NOT EXISTS intern_logs (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER         NOT NULL REFERENCES users(id),
    log_date            DATE            NOT NULL DEFAULT CURRENT_DATE,
    hours               NUMERIC(4,2)    NOT NULL,
    summary             TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, log_date)
);
