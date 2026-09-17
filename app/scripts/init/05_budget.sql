-- =============================================================
-- Budget Setup — MetabolicTrack Lab PM System
-- Run after schema.sql and cortisol_p1_tasks_seed.sql
-- =============================================================

-- =============================================================
-- System-wide default budget alert threshold (80%)
-- Set per-project overrides below
-- =============================================================

-- Update Cortisol Phase 1 project with hourly rate and alert threshold
-- Adjust budget_allocated and hourly_rate to your actual figures
UPDATE projects
SET
    budget_allocated        = 0.00,      -- set your Phase 1 total budget here
    hourly_rate             = 0.00,      -- set your lab hourly billing rate here
    budget_alert_threshold  = 80.00      -- alert at 80% spend
WHERE code = 'CORT-P1';

-- =============================================================
-- Phase budgets for Cortisol Phase 1
-- Each phase maps to the task groups in your project plan
-- =============================================================

INSERT INTO project_phases (project_id, phase_name, phase_number, budget_allocated, start_date, end_date, budget_alert_threshold, is_active)
SELECT
    p.id,
    phases.phase_name,
    phases.phase_number,
    0.00,           -- set allocated budget per phase — update after ops manager review
    phases.start_date::DATE,
    phases.end_date::DATE,
    80.00,
    TRUE
FROM projects p,
(VALUES
    ('Phase initiation',                1, '2026-03-20', '2026-04-23'),
    ('Material and antibody screening', 2, '2026-03-25', '2026-07-21'),
    ('Analytical validation',           3, '2026-07-22', '2027-01-13'),
    ('Documentation and report',        4, '2026-07-22', '2026-09-04')
) AS phases(phase_name, phase_number, start_date, end_date)
WHERE p.code = 'CORT-P1'
ON CONFLICT (project_id, phase_number) DO NOTHING;

-- =============================================================
-- VERIFICATION
-- =============================================================
SELECT
    p.code,
    p.name,
    p.budget_allocated      AS project_budget,
    p.hourly_rate,
    p.budget_alert_threshold AS alert_pct,
    COUNT(pp.id)            AS phases
FROM projects p
LEFT JOIN project_phases pp ON pp.project_id = p.id
GROUP BY p.id, p.code, p.name, p.budget_allocated, p.hourly_rate, p.budget_alert_threshold;
