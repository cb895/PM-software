-- =============================================================
-- Reconcile leave_balances after the PTO double-counting bug
-- =============================================================
-- Before sql_patches/06 and the matching hr.py fix, every vacation
-- (PTO) leave approval/denial/cancellation applied its pending/used
-- adjustment TWICE (once via review_leave_request()/
-- cancel_leave_request()'s own UPDATE, once via the
-- trg_pto_on_approval trigger those UPDATEs fired) — so pto_used and
-- pto_pending in leave_balances can be inflated for any vacation
-- request touched before that fix went live.
--
-- leave_requests is the source of truth for what SHOULD be in
-- leave_balances: pto_used is just the sum of days_requested for a
-- user/year's approved vacation requests, and pto_pending is the same
-- sum over still-pending ones. This recomputes both from scratch, so
-- it fully corrects any amount of double- (or triple-, etc.)
-- counting regardless of how many times the bug fired historically,
-- and it's a no-op wherever the numbers were already correct.
--
-- Safe to re-run at any time — it always recomputes from
-- leave_requests, it never accumulates.

\echo 'Rows about to change (old -> correct):'
SELECT
    lb.user_id, u.full_name, lb.year,
    lb.pto_used    AS old_used,
    COALESCE((
        SELECT SUM(lr.days_requested) FROM leave_requests lr
        WHERE lr.user_id = lb.user_id AND lr.leave_type = 'vacation'
          AND lr.status = 'approved'
          AND EXTRACT(YEAR FROM lr.start_date)::INT = lb.year
    ), 0) AS correct_used,
    lb.pto_pending AS old_pending,
    COALESCE((
        SELECT SUM(lr.days_requested) FROM leave_requests lr
        WHERE lr.user_id = lb.user_id AND lr.leave_type = 'vacation'
          AND lr.status = 'pending'
          AND EXTRACT(YEAR FROM lr.start_date)::INT = lb.year
    ), 0) AS correct_pending
FROM leave_balances lb
JOIN users u ON u.id = lb.user_id
WHERE lb.pto_used <> COALESCE((
        SELECT SUM(lr.days_requested) FROM leave_requests lr
        WHERE lr.user_id = lb.user_id AND lr.leave_type = 'vacation'
          AND lr.status = 'approved'
          AND EXTRACT(YEAR FROM lr.start_date)::INT = lb.year
    ), 0)
   OR lb.pto_pending <> COALESCE((
        SELECT SUM(lr.days_requested) FROM leave_requests lr
        WHERE lr.user_id = lb.user_id AND lr.leave_type = 'vacation'
          AND lr.status = 'pending'
          AND EXTRACT(YEAR FROM lr.start_date)::INT = lb.year
    ), 0)
ORDER BY u.full_name;

\echo 'Applying fix...'
UPDATE leave_balances lb
SET
    pto_used = COALESCE((
        SELECT SUM(lr.days_requested) FROM leave_requests lr
        WHERE lr.user_id = lb.user_id AND lr.leave_type = 'vacation'
          AND lr.status = 'approved'
          AND EXTRACT(YEAR FROM lr.start_date)::INT = lb.year
    ), 0),
    pto_pending = COALESCE((
        SELECT SUM(lr.days_requested) FROM leave_requests lr
        WHERE lr.user_id = lb.user_id AND lr.leave_type = 'vacation'
          AND lr.status = 'pending'
          AND EXTRACT(YEAR FROM lr.start_date)::INT = lb.year
    ), 0),
    updated_at = NOW();

\echo 'Reconciliation complete. Current balances:'
SELECT u.full_name, lb.year, lb.pto_total, lb.pto_used, lb.pto_pending,
       lb.pto_total - lb.pto_used - lb.pto_pending AS remaining
FROM leave_balances lb
JOIN users u ON u.id = lb.user_id
ORDER BY u.full_name;
