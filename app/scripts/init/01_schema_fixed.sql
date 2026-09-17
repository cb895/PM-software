
-- =============================================================
-- DELAY PROPOSALS — auto-generated from daily log analysis
-- =============================================================

CREATE TABLE task_delay_proposals (
    id               SERIAL PRIMARY KEY,
    task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    log_entry_id     INTEGER REFERENCES daily_log_entries(id) ON DELETE SET NULL,
    proposed_by      INTEGER REFERENCES users(id),
    detected_from    TEXT,                       -- the blocker text that triggered this
    estimated_delay_days INTEGER NOT NULL,
    confidence       VARCHAR(20) DEFAULT 'medium', -- low | medium | high
    reason           TEXT,                        -- plain-English explanation from Claude
    original_end     DATE,
    proposed_end     DATE,
    status           VARCHAR(20) DEFAULT 'pending', -- pending | approved | dismissed
    reviewed_by      INTEGER REFERENCES users(id),
    reviewed_at      TIMESTAMPTZ,
    review_notes     TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_delay_proposals_task   ON task_delay_proposals(task_id);
CREATE INDEX idx_delay_proposals_status ON task_delay_proposals(status);
