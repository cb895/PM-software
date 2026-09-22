-- =============================================================
-- HR Portal Schema — MetabolicTrack Lab PM
-- Time off requests, calendar, in/out status, leave balances
-- =============================================================

-- ---- Enums ----

CREATE TYPE leave_type AS ENUM (
    'vacation',     -- PTO from annual balance
    'sick',         -- up to 5 days per incident; flags HR after that
    'personal',     -- HR discretion
    'bereavement',  -- HR discretion
    'medical',      -- HR discretion (FMLA-type)
    'unpaid'        -- HR discretion
);

CREATE TYPE leave_status AS ENUM (
    'pending',      -- submitted, awaiting ops manager review
    'approved',     -- approved by ops manager
    'denied',       -- denied by ops manager
    'cancelled'     -- withdrawn by employee
);

CREATE TYPE inout_status AS ENUM (
    'in_office',
    'remote',
    'off',
    'sick'
);

CREATE TYPE meeting_type AS ENUM (
    'team',         -- visible to all
    'one_on_one',   -- visible to participants only
    'private'       -- visible to creator + ops manager only
);

-- ---- Leave balances ----
-- One row per user per year; PTO tracked here, others logged only

CREATE TABLE leave_balances (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year            INTEGER NOT NULL,
    pto_total       NUMERIC(5,2) NOT NULL DEFAULT 15,   -- annual PTO days
    pto_used        NUMERIC(5,2) NOT NULL DEFAULT 0,
    pto_pending     NUMERIC(5,2) NOT NULL DEFAULT 0,    -- approved but not yet taken
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, year)
);

-- ---- Work schedule overrides ----
-- Patricia's Tuesdays off by default; this table stores per-week overrides

CREATE TABLE work_schedule_overrides (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start      DATE NOT NULL,          -- Monday of the week
    regular_day_off INTEGER NOT NULL,       -- 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
    override_day_off INTEGER,               -- NULL = keep regular day off; integer = move to this day
    override_reason TEXT,
    set_by          INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, week_start)
);

-- ---- Time off requests ----

CREATE TABLE leave_requests (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    leave_type      leave_type NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    days_requested  NUMERIC(5,2) NOT NULL,  -- business days
    notes           TEXT,
    approx_days     INTEGER,                -- for open-ended leave types
    status          leave_status NOT NULL DEFAULT 'pending',
    reviewed_by     INTEGER REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    review_notes    TEXT,
    -- Sick leave tracking
    incident_days   INTEGER DEFAULT 0,      -- consecutive business days so far
    hr_meeting_required BOOLEAN DEFAULT FALSE,
    hr_meeting_date DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leave_requests_user    ON leave_requests(user_id);
CREATE INDEX idx_leave_requests_status  ON leave_requests(status);
CREATE INDEX idx_leave_requests_dates   ON leave_requests(start_date, end_date);

-- ---- Staff in/out status ----

CREATE TABLE staff_status (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    status          inout_status NOT NULL DEFAULT 'in_office',
    status_note     TEXT,                   -- optional e.g. "Back at 2pm"
    auto_status     inout_status,           -- what the system set based on leave/calendar
    manual_override BOOLEAN DEFAULT FALSE,  -- true if manually set
    override_by     INTEGER REFERENCES users(id),
    last_updated    TIMESTAMPTZ DEFAULT NOW()
);

-- ---- Calendar events ----

CREATE TABLE calendar_events (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    event_type      meeting_type NOT NULL DEFAULT 'team',
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    all_day         BOOLEAN DEFAULT FALSE,
    location        TEXT,
    created_by      INTEGER NOT NULL REFERENCES users(id),
    is_recurring    BOOLEAN DEFAULT FALSE,
    recurrence_rule TEXT,                   -- simple RRULE string e.g. 'WEEKLY:TUE'
    related_leave_id INTEGER REFERENCES leave_requests(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX idx_calendar_events_type  ON calendar_events(event_type);

-- ---- Calendar event participants ----

CREATE TABLE calendar_event_participants (
    id              SERIAL PRIMARY KEY,
    event_id        INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response        VARCHAR(20) DEFAULT 'pending',  -- pending | accepted | declined
    UNIQUE (event_id, user_id)
);

-- ---- View: who's in/out today ----

CREATE VIEW staff_status_today AS
SELECT
    u.id            AS user_id,
    u.full_name,
    u.role,
    u.email,
    COALESCE(ss.status, 'in_office')        AS status,
    ss.status_note,
    ss.manual_override,
    ss.last_updated,
    -- Check for approved leave today
    (SELECT lr.leave_type FROM leave_requests lr
     WHERE lr.user_id = u.id
       AND lr.status = 'approved'
       AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
     LIMIT 1)                               AS leave_type_today,
    -- PTO balance for current year
    lb.pto_total,
    lb.pto_used,
    lb.pto_pending,
    GREATEST(lb.pto_total - lb.pto_used - lb.pto_pending, 0) AS pto_remaining
FROM users u
LEFT JOIN staff_status ss ON ss.user_id = u.id
LEFT JOIN leave_balances lb ON lb.user_id = u.id AND lb.year = EXTRACT(YEAR FROM CURRENT_DATE)
WHERE u.is_active = TRUE
ORDER BY u.full_name;

-- ---- Function: count business days between two dates ----

CREATE OR REPLACE FUNCTION fn_business_days(p_start DATE, p_end DATE)
RETURNS NUMERIC AS $$
    SELECT COUNT(*)::NUMERIC
    FROM generate_series(p_start, p_end, '1 day'::INTERVAL) d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;
$$ LANGUAGE SQL IMMUTABLE;

-- ---- Function: auto-update staff status from approved leave ----

CREATE OR REPLACE FUNCTION fn_sync_staff_status()
RETURNS void AS $$
DECLARE
    v_user  RECORD;
    v_leave leave_type;
    v_new_status inout_status;
BEGIN
    FOR v_user IN SELECT id FROM users WHERE is_active = TRUE LOOP
        -- Check if there's approved leave today
        SELECT lr.leave_type INTO v_leave
        FROM leave_requests lr
        WHERE lr.user_id = v_user.id
          AND lr.status = 'approved'
          AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
        LIMIT 1;

        IF v_leave IS NOT NULL THEN
            v_new_status := CASE
                WHEN v_leave = 'sick'    THEN 'sick'::inout_status
                WHEN v_leave = 'unpaid'  THEN 'off'::inout_status
                ELSE 'off'::inout_status
            END;

            -- Only update if not manually overridden
            INSERT INTO staff_status (user_id, status, auto_status, manual_override, last_updated)
            VALUES (v_user.id, v_new_status, v_new_status, FALSE, NOW())
            ON CONFLICT (user_id) DO UPDATE
                SET status       = CASE WHEN staff_status.manual_override THEN staff_status.status ELSE v_new_status END,
                    auto_status  = v_new_status,
                    last_updated = NOW()
            WHERE NOT staff_status.manual_override;
        ELSE
            -- No active leave today — clear any stale auto-status (e.g. a
            -- previous approved leave period that has since ended) back to
            -- in_office. DO NOTHING here would leave a status like 'sick'
            -- or 'off' stuck forever once set, since this function is the
            -- only thing that ever clears it and it only ever ran again
            -- when some other leave request happened to get approved.
            -- Never touches a manually-overridden status.
            INSERT INTO staff_status (user_id, status, auto_status, manual_override, last_updated)
            VALUES (v_user.id, 'in_office', NULL, FALSE, NOW())
            ON CONFLICT (user_id) DO UPDATE
                SET status       = 'in_office',
                    auto_status  = NULL,
                    last_updated = NOW()
            WHERE NOT staff_status.manual_override;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ---- Trigger: when leave is approved, update PTO balance ----

CREATE OR REPLACE FUNCTION fn_update_pto_on_approval()
RETURNS TRIGGER AS $$
BEGIN
    -- Only handle vacation (PTO) type
    IF NEW.leave_type = 'vacation' THEN
        IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
            -- Move from pending to used
            UPDATE leave_balances
            SET pto_pending = GREATEST(pto_pending - NEW.days_requested, 0),
                pto_used    = pto_used + NEW.days_requested,
                updated_at  = NOW()
            WHERE user_id = NEW.user_id
              AND year = EXTRACT(YEAR FROM NEW.start_date);

        ELSIF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
            -- New request submitted
            UPDATE leave_balances
            SET pto_pending = pto_pending + NEW.days_requested,
                updated_at  = NOW()
            WHERE user_id = NEW.user_id
              AND year = EXTRACT(YEAR FROM NEW.start_date);

        ELSIF NEW.status = 'denied' AND OLD.status = 'pending' THEN
            -- Release pending
            UPDATE leave_balances
            SET pto_pending = GREATEST(pto_pending - NEW.days_requested, 0),
                updated_at  = NOW()
            WHERE user_id = NEW.user_id
              AND year = EXTRACT(YEAR FROM NEW.start_date);

        ELSIF NEW.status = 'cancelled' THEN
            -- Release pending or used depending on old status
            UPDATE leave_balances
            SET pto_pending = GREATEST(pto_pending - CASE WHEN OLD.status = 'pending' THEN NEW.days_requested ELSE 0 END, 0),
                pto_used    = GREATEST(pto_used    - CASE WHEN OLD.status = 'approved' THEN NEW.days_requested ELSE 0 END, 0),
                updated_at  = NOW()
            WHERE user_id = NEW.user_id
              AND year = EXTRACT(YEAR FROM NEW.start_date);
        END IF;
    END IF;

    -- Flag sick leave after 5 consecutive business days
    IF NEW.leave_type = 'sick' AND NEW.status = 'approved' THEN
        IF NEW.days_requested >= 5 THEN
            NEW.hr_meeting_required := TRUE;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pto_on_approval
    BEFORE UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION fn_update_pto_on_approval();

-- =============================================================
-- SEED DATA
-- =============================================================

-- Initialise staff_status for all active users
INSERT INTO staff_status (user_id, status, manual_override)
SELECT id, 'in_office', FALSE FROM users WHERE is_active = TRUE
ON CONFLICT (user_id) DO NOTHING;

-- Seed 2026 leave balances
INSERT INTO leave_balances (user_id, year, pto_total, pto_used, pto_pending)
SELECT
    u.id,
    2026,
    CASE u.email
        WHEN 'pw@metabolictrack.com' THEN 12   -- Patricia: 4/5 of 15
        WHEN 'el@metabolictrack.com' THEN 10   -- Emma Claire: 10 days
        ELSE 15                                -- Everyone else: 15 days
    END,
    0, 0
FROM users u
WHERE u.is_active = TRUE
ON CONFLICT (user_id, year) DO NOTHING;

-- Patricia's standing Tuesday schedule for the rest of 2026
-- Generate every Monday (week_start) from today through end of 2026
INSERT INTO work_schedule_overrides (user_id, week_start, regular_day_off, override_day_off, override_reason, set_by)
SELECT
    (SELECT id FROM users WHERE email = 'pw@metabolictrack.com'),
    d::DATE,
    2,      -- Tuesday
    NULL,   -- no override — use default Tuesday off
    'Standing 4-day work week schedule',
    (SELECT id FROM users WHERE email = 'cb@metabolictrack.com')
FROM generate_series(
    date_trunc('week', CURRENT_DATE)::DATE,
    '2026-12-28'::DATE,
    '7 days'::INTERVAL
) d
ON CONFLICT (user_id, week_start) DO NOTHING;

-- =============================================================
-- VERIFICATION
-- =============================================================
SELECT 'Leave balances seeded: ' || COUNT(*)::TEXT FROM leave_balances;
SELECT 'Staff status rows: '     || COUNT(*)::TEXT FROM staff_status;
SELECT 'PW schedule weeks: '     || COUNT(*)::TEXT FROM work_schedule_overrides;
