-- =============================================================
-- KPI Fix Script — run this on the deployed server
-- Fixes: missing targets, re-seeds them, then computes actuals
--
-- Usage:
--   docker cp fix_kpi.sql labpm_db:/fix_kpi.sql
--   docker compose exec db psql -U labpm_user labpm -f /fix_kpi.sql
-- =============================================================

\echo 'Step 1: Checking for KPI targets...'
SELECT COUNT(*) AS existing_targets FROM kpi_targets;

\echo 'Step 2: Clearing any partial/broken targets and actuals...'
TRUNCATE kpi_actuals;
DELETE FROM kpi_targets;

\echo 'Step 3: Re-seeding KPI targets...'
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
    NULL,   -- applies to all lab techs
    NULL,   -- applies to all projects
    target_value,
    unit,
    period::kpi_period,
    TRUE,
    TRUE,
    '2026-03-20'::DATE,  -- CORT-P1 project start
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
     'Percentage of working days in the week where the employee submitted their daily log.',
     100.0, '%', 'weekly'),

    ('on_time_task_completion',
     'Weekly on-time task completion',
     'Percentage of tasks completed this week that were finished on or before their planned end date.',
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
     'Percentage of working days in the month where the employee submitted their daily log.',
     95.0, '%', 'monthly'),

    ('on_time_task_completion',
     'Monthly on-time task completion',
     'Percentage of tasks completed this month that were finished on or before their planned end date.',
     85.0, '%', 'monthly')

) AS t(metric_type, metric_name, description, target_value, unit, period);

SELECT COUNT(*) AS targets_inserted FROM kpi_targets;

\echo 'Step 4: Computing weekly KPIs for current and recent periods...'

-- Current week
SELECT fn_compute_kpi_actuals('weekly') AS weekly_current;

-- Previous week
SELECT fn_compute_kpi_actuals('weekly',
    date_trunc('week', CURRENT_DATE - INTERVAL '7 days')::DATE
) AS weekly_previous;

-- Two weeks ago
SELECT fn_compute_kpi_actuals('weekly',
    date_trunc('week', CURRENT_DATE - INTERVAL '14 days')::DATE
) AS weekly_2_ago;

-- Three weeks ago
SELECT fn_compute_kpi_actuals('weekly',
    date_trunc('week', CURRENT_DATE - INTERVAL '21 days')::DATE
) AS weekly_3_ago;

\echo 'Step 5: Computing monthly KPIs...'

-- Current month
SELECT fn_compute_kpi_actuals('monthly') AS monthly_current;

-- Previous month
SELECT fn_compute_kpi_actuals('monthly',
    date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::DATE
) AS monthly_previous;

\echo 'Step 6: Verifying results...'
SELECT
    kt.metric_name,
    kt.period,
    u.full_name AS employee,
    ka.period_start,
    ka.actual_value,
    kt.target_value,
    ka.met_target
FROM kpi_actuals ka
JOIN kpi_targets kt ON kt.id = ka.kpi_target_id
JOIN users u        ON u.id  = ka.user_id
ORDER BY ka.period_start DESC, kt.metric_type, u.full_name
LIMIT 40;

\echo 'KPI fix complete.'
