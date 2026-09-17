-- =============================================================
-- HR Schema Migration — run on your deployed N100 server
-- Safe to run on existing database — won't touch existing data
--
-- Usage:
--   docker cp apply_hr_schema.sql labpm_db:/apply_hr_schema.sql
--   docker compose exec db psql -U labpm_user labpm -f /apply_hr_schema.sql
-- =============================================================

\echo 'Applying HR schema migration...'

-- Enums (skip if already exist)
DO $$ BEGIN
    CREATE TYPE leave_type AS ENUM ('vacation','sick','personal','bereavement','medical','unpaid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE leave_status AS ENUM ('pending','approved','denied','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE inout_status AS ENUM ('in_office','remote','off','sick');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE meeting_type AS ENUM ('team','one_on_one','private');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tables (skip if already exist)
CREATE TABLE IF NOT EXISTS leave_balances (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year        INTEGER NOT NULL,
    pto_total   NUMERIC(5,2) NOT NULL DEFAULT 15,
    pto_used    NUMERIC(5,2) NOT NULL DEFAULT 0,
    pto_pending NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, year)
);

CREATE TABLE IF NOT EXISTS work_schedule_overrides (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start       DATE NOT NULL,
    regular_day_off  INTEGER NOT NULL,
    override_day_off INTEGER,
    override_reason  TEXT,
    set_by           INTEGER REFERENCES users(id),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, week_start)
);

CREATE TABLE IF NOT EXISTS leave_requests (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id),
    leave_type          leave_type NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    days_requested      NUMERIC(5,2) NOT NULL,
    notes               TEXT,
    approx_days         INTEGER,
    status              leave_status NOT NULL DEFAULT 'pending',
    reviewed_by         INTEGER REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,
    incident_days       INTEGER DEFAULT 0,
    hr_meeting_required BOOLEAN DEFAULT FALSE,
    hr_meeting_date     DATE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_status (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    status          inout_status NOT NULL DEFAULT 'in_office',
    status_note     TEXT,
    auto_status     inout_status,
    manual_override BOOLEAN DEFAULT FALSE,
    override_by     INTEGER REFERENCES users(id),
    last_updated    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id               SERIAL PRIMARY KEY,
    title            TEXT NOT NULL,
    description      TEXT,
    event_type       meeting_type NOT NULL DEFAULT 'team',
    start_time       TIMESTAMPTZ NOT NULL,
    end_time         TIMESTAMPTZ NOT NULL,
    all_day          BOOLEAN DEFAULT FALSE,
    location         TEXT,
    created_by       INTEGER NOT NULL REFERENCES users(id),
    is_recurring     BOOLEAN DEFAULT FALSE,
    recurrence_rule  TEXT,
    related_leave_id INTEGER REFERENCES leave_requests(id),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_event_participants (
    id       SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response VARCHAR(20) DEFAULT 'pending',
    UNIQUE (event_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leave_requests_user   ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates  ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);

-- Views (replace if exists)
CREATE OR REPLACE VIEW staff_status_today AS
SELECT
    u.id AS user_id, u.full_name, u.role, u.email,
    COALESCE(ss.status, 'in_office') AS status,
    ss.status_note, ss.manual_override, ss.last_updated,
    (SELECT lr.leave_type FROM leave_requests lr
     WHERE lr.user_id = u.id AND lr.status = 'approved'
       AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date LIMIT 1) AS leave_type_today,
    lb.pto_total, lb.pto_used, lb.pto_pending,
    GREATEST(lb.pto_total - lb.pto_used - lb.pto_pending, 0) AS pto_remaining
FROM users u
LEFT JOIN staff_status ss ON ss.user_id = u.id
LEFT JOIN leave_balances lb ON lb.user_id = u.id AND lb.year = EXTRACT(YEAR FROM CURRENT_DATE)
WHERE u.is_active = TRUE ORDER BY u.full_name;

-- Functions
CREATE OR REPLACE FUNCTION fn_business_days(p_start DATE, p_end DATE)
RETURNS NUMERIC AS $$
    SELECT COUNT(*)::NUMERIC FROM generate_series(p_start, p_end, '1 day'::INTERVAL) d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_sync_staff_status() RETURNS void AS $$
DECLARE v_user RECORD; v_leave leave_type; v_new inout_status;
BEGIN
    FOR v_user IN SELECT id FROM users WHERE is_active = TRUE LOOP
        SELECT lr.leave_type INTO v_leave FROM leave_requests lr
        WHERE lr.user_id = v_user.id AND lr.status = 'approved'
          AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date LIMIT 1;
        IF v_leave IS NOT NULL THEN
            v_new := CASE WHEN v_leave = 'sick' THEN 'sick'::inout_status ELSE 'off'::inout_status END;
            INSERT INTO staff_status (user_id, status, auto_status, manual_override, last_updated)
            VALUES (v_user.id, v_new, v_new, FALSE, NOW())
            ON CONFLICT (user_id) DO UPDATE
                SET status = CASE WHEN staff_status.manual_override THEN staff_status.status ELSE v_new END,
                    auto_status = v_new, last_updated = NOW()
            WHERE NOT staff_status.manual_override;
        ELSE
            INSERT INTO staff_status (user_id, status, auto_status, manual_override)
            VALUES (v_user.id, 'in_office', NULL, FALSE)
            ON CONFLICT (user_id) DO NOTHING;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Seed initial data
INSERT INTO staff_status (user_id, status, manual_override)
SELECT id, 'in_office', FALSE FROM users WHERE is_active = TRUE
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO leave_balances (user_id, year, pto_total)
SELECT u.id, 2026,
    CASE u.email
        WHEN 'pw@metabolictrack.com' THEN 12
        WHEN 'el@metabolictrack.com' THEN 10
        ELSE 15
    END
FROM users u WHERE u.is_active = TRUE
ON CONFLICT (user_id, year) DO NOTHING;

-- Patricia's Tuesday schedule through end of 2026
INSERT INTO work_schedule_overrides (user_id, week_start, regular_day_off, set_by)
SELECT
    (SELECT id FROM users WHERE email = 'pw@metabolictrack.com'),
    d::DATE, 2,
    (SELECT id FROM users WHERE email = 'cb@metabolictrack.com')
FROM generate_series(date_trunc('week', CURRENT_DATE)::DATE, '2026-12-28'::DATE, '7 days'::INTERVAL) d
ON CONFLICT (user_id, week_start) DO NOTHING;

\echo 'Verification:'
SELECT 'leave_balances rows: ' || COUNT(*)::TEXT FROM leave_balances;
SELECT 'staff_status rows: '   || COUNT(*)::TEXT FROM staff_status;
SELECT 'PW schedule weeks: '   || COUNT(*)::TEXT FROM work_schedule_overrides;

\echo 'HR schema migration complete.'
