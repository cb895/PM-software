-- =============================================================
-- Fix fn_sync_staff_status() — stale in/out status never cleared
-- =============================================================
-- The "no active leave today" branch used INSERT ... ON CONFLICT DO NOTHING,
-- so once someone's approved leave set their status to 'sick' or 'off', it
-- stayed that way forever once the leave period ended — this function is
-- the only thing that ever resets it, and it only ran when some other leave
-- request happened to be approved (or someone clicked "Sync from leave
-- data"). Fixed to actually reset back to in_office once no leave covers
-- today, while still never touching a manually-overridden status.
--
-- Safe to re-run.

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
            -- No active leave today — clear any stale auto-status back to
            -- in_office. Never touches a manually-overridden status.
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

-- Run it once immediately so any already-stale rows get corrected now,
-- not just on the next scheduled run.
SELECT fn_sync_staff_status();
