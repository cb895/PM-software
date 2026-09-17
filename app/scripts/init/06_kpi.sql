-- =============================================================
-- KPI Setup — MetabolicTrack Lab PM System
-- Seeds the four core system KPIs for all lab techs
-- Runs after schema, users, and tasks are in place
-- =============================================================

-- Wait for users to exist (should always be true if init order is correct)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'cb@metabolictrack.com') THEN
        RAISE EXCEPTION 'cb@metabolictrack.com not found — run 02_cortisol_tasks.sql first';
    END IF;
END $$;

-- Clear any partial data from failed runs
DELETE FROM kpi_actuals;
DELETE FROM kpi_targets;

-- =============================================================
-- SYSTEM KPIs — auto-computed by fn_compute_kpi_actuals()
-- user_id  = NULL → applies to all lab techs
-- project_id = NULL → applies to all active projects
-- =============================================================

INSERT INTO kpi_targets (
    metric_type, metric_name, description,
    user_id, project_id,
    target_value, unit, period,
    is_system, is_active, effective_from,
    created_by
)
SELECT
    metric_type::kpi_metric_type,
    metric_name,
    description,
    NULL,
    NULL,
    target_value,
    unit,
    period::kpi_period,
    TRUE,
    TRUE,
    '2026-03-20'::DATE,
    (SELECT id FROM users WHERE email = 'cb@metabolictrack.com' LIMIT 1)
FROM (VALUES
    ('task_completion_rate',
     'Weekly task completion rate',
     'Percentage of tasks with a planned end date this week that were completed.',
     90.0, '%', 'weekly'),

    ('hours_logged',
     'Weekly hours logged',
     'Total hours logged per employee per project per week.',
     35.0, 'hours', 'weekly'),

    ('log_submission_rate',
     'Weekly log submission rate',
     'Percentage of working days where the employee submitted their daily log.',
     100.0, '%', 'weekly'),

    ('on_time_task_completion',
     'Weekly on-time task completion',
     'Percentage of tasks completed this week finished on or before planned end date.',
     85.0, '%', 'weekly'),

    ('task_completion_rate',
     'Monthly task completion rate',
     'Percentage of tasks with a planned end date this month that were completed.',
     90.0, '%', 'monthly'),

    ('hours_logged',
     'Monthly hours logged',
     'Total hours logged per employee per project per month.',
     140.0, 'hours', 'monthly'),

    ('log_submission_rate',
     'Monthly log submission rate',
     'Percentage of working days in the month where the employee submitted their log.',
     95.0, '%', 'monthly'),

    ('on_time_task_completion',
     'Monthly on-time task completion',
     'Percentage of tasks completed this month finished on or before planned end date.',
     85.0, '%', 'monthly')

) AS t(metric_type, metric_name, description, target_value, unit, period);

-- =============================================================
-- Compute initial actuals for the last 4 weeks + 2 months
-- so the KPI page has data to show immediately after install
-- =============================================================

SELECT fn_compute_kpi_actuals('weekly',
    date_trunc('week', CURRENT_DATE - INTERVAL '21 days')::DATE);
SELECT fn_compute_kpi_actuals('weekly',
    date_trunc('week', CURRENT_DATE - INTERVAL '14 days')::DATE);
SELECT fn_compute_kpi_actuals('weekly',
    date_trunc('week', CURRENT_DATE - INTERVAL '7 days')::DATE);
SELECT fn_compute_kpi_actuals('weekly');

SELECT fn_compute_kpi_actuals('monthly',
    date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::DATE);
SELECT fn_compute_kpi_actuals('monthly');

-- =============================================================
-- Verification
-- =============================================================
SELECT
    'Targets seeded: ' || COUNT(*)::TEXT AS result
FROM kpi_targets;

SELECT
    'Actuals computed: ' || COUNT(*)::TEXT AS result
FROM kpi_actuals;

-- =============================================================
-- CRON JOBS — already configured in labpm_cron container
-- Weekly:  every Monday at 6:30am
-- Monthly: 1st of each month at 6:30am
-- =============================================================
