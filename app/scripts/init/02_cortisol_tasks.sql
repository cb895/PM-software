-- =============================================================
-- SCHEMA ADDITION: task_assignees junction table
-- Run this AFTER schema.sql if not already applied
-- =============================================================

ALTER TABLE tasks DROP COLUMN IF EXISTS assigned_to;

CREATE TABLE IF NOT EXISTS task_assignees (
    id          SERIAL PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);

-- =============================================================
-- PROJECT: Cortisol Phase 1 - Development
-- =============================================================

-- Step 1: Ensure project exists
INSERT INTO projects (code, name, description, client, start_date, end_date, is_active)
VALUES ('CORT-P1', 'Cortisol Phase 1 - Development',
        'Phase 1 development of cortisol lateral flow assay',
        'Internal', '2026-03-20', '2026-09-04', TRUE)
ON CONFLICT (code) DO NOTHING;

-- Step 2: Ensure all team members exist as users
-- Adjust emails and roles to match your actual staff
-- Upsert all users — ON CONFLICT updates name/role so re-runs are safe
INSERT INTO users (full_name, email, hashed_password, role) VALUES
    ('Chris Bagley',    'cb@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'ops_manager'),
    ('Kevin Jones',     'kj@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'ceo'),
    ('Kaytlyn Crowe',   'kc@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'qm_director'),
    ('Andrew Dimis',    'ad@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'lab_tech'),
    ('Patricia Walker', 'pw@metabolictrack.com',  crypt('ChangeMe!', gen_salt('bf',12)), 'lab_tech')
ON CONFLICT (email) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        role      = EXCLUDED.role;

-- Emma Claire: third lab tech hired but not yet onboarded — account inactive until ready
INSERT INTO users (full_name, email, hashed_password, role, is_active)
VALUES ('Emma Claire', 'el@metabolictrack.com', crypt('ChangeMe!', gen_salt('bf',12)), 'lab_tech', TRUE)
ON CONFLICT (email) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        role      = EXCLUDED.role,
        is_active = TRUE;

-- =============================================================
-- Step 3: Insert task groups as a label on tasks (via description prefix)
-- Step 4: Insert all parent tasks
-- Step 5: Insert subtasks (parent_task_id set via subquery)
-- Step 6: Insert assignees into task_assignees
-- =============================================================

DO $$
DECLARE
    v_project_id INTEGER;
    t0 INTEGER; -- Phase initiation meeting
    t1 INTEGER; -- Update Design and Development plan
    t2 INTEGER; -- MDF & DDF design
    t3 INTEGER; -- Produce Analytical Verification Protocols
    t4 INTEGER; -- IRB Submission
    t5 INTEGER; -- Source commercial colloids
    t6 INTEGER; -- Conjugation studies
    t7 INTEGER; -- Source commercial antibodies
    t8 INTEGER; -- Test combinations in 1/2 strip
    t9 INTEGER; -- Combination report and decision
    t10 INTEGER; -- Membrane studies in composite samples
    t11 INTEGER; -- Drying studies
    t12 INTEGER; -- Running buffer studies
    t13 INTEGER; -- Saliva collection and use
    t14 INTEGER; -- Lab prototype/process finalized
    t15 INTEGER; -- Finalize Development Prototype
    t16 INTEGER; -- LOD
    t17 INTEGER; -- Dose response
    t18 INTEGER; -- Analytical range
    t19 INTEGER; -- Quantitative range
    t20 INTEGER; -- Sample volume studies
    t21 INTEGER; -- Run time
    t22 INTEGER; -- Stability
    t23 INTEGER; -- Multi-lot testing
    t24 INTEGER; -- BOM (Dev Prototype)
    t25 INTEGER; -- Development report
    t26 INTEGER; -- Manufacturing SOPs (Dev Prototype)
    t27 INTEGER; -- QC testing and release criteria (Dev Prototype)
    t28 INTEGER; -- Updated risk analysis
    t29 INTEGER; -- Product specification (Dev Prototype)
    t30 INTEGER; -- Trace matrix (PRD vs Dev specification)
    t31 INTEGER; -- Design review Phase 1
BEGIN
    SELECT id INTO v_project_id FROM projects WHERE code = 'CORT-P1';

    -- ---- Phase initiation ----
    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Phase initiation meeting',
            'Phase initiation',
            'complete', 'critical', '2026-03-24', '2026-03-24', FALSE)
    RETURNING id INTO t0;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t0, id FROM users WHERE full_name = 'Chris Bagley';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Update Design and Development plan',
            'Phase initiation',
            'not_started', 'critical', '2026-03-25', '2026-04-01', FALSE)
    RETURNING id INTO t1;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t1, id FROM users WHERE full_name = 'Kevin Jones';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'MDF & DDF design',
            'Phase initiation',
            'not_started', 'high', '2026-03-20', '2026-07-30', FALSE)
    RETURNING id INTO t2;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t2, id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t2, id FROM users WHERE full_name = 'Chris Bagley';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Produce Analytical Verification Protocols',
            'Phase initiation',
            'in_progress', 'high', '2026-04-02', '2026-04-23', FALSE)
    RETURNING id INTO t3;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t3, id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'LOD', 'not_started', 'high', '2026-04-02', '2026-04-23', FALSE, t3);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Dose response', 'not_started', 'high', '2026-04-02', '2026-04-23', FALSE, t3);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Analytical range', 'not_started', 'high', '2026-04-02', '2026-04-23', FALSE, t3);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Quantitative range', 'not_started', 'high', '2026-04-02', '2026-04-23', FALSE, t3);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Sample Volume Studies', 'not_started', 'high', '2026-04-02', '2026-04-23', FALSE, t3);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Run time', 'not_started', 'high', '2026-04-02', '2026-04-23', FALSE, t3);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Stability', 'not_started', 'high', '2026-04-02', '2026-04-23', FALSE, t3);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Multi-lot testing', 'not_started', 'high', '2026-04-02', '2026-04-23', FALSE, t3);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Kaytlyn Crowe';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'IRB Submission',
            'Phase initiation',
            'not_started', 'critical', '2026-03-27', '2026-05-29', FALSE)
    RETURNING id INTO t4;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t4, id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t4, id FROM users WHERE full_name = 'Chris Bagley';


    -- ---- Material and antibody screening ----
    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Source commercial colloids',
            'Material and antibody screening',
            'in_progress', 'critical', '2026-03-25', '2026-04-01', FALSE)
    RETURNING id INTO t5;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t5, id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Survey commercial sources', 'not_started', 'critical', '2026-03-25', '2026-04-01', FALSE, t5);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Order materials', 'not_started', 'critical', '2026-03-25', '2026-04-01', FALSE, t5);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Chris Bagley';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Conjugation studies',
            'Material and antibody screening',
            'in_progress', 'high', '2026-04-06', '2026-04-24', FALSE)
    RETURNING id INTO t6;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t6, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t6, id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 1', 'not_started', 'high', '2026-04-06', '2026-04-24', FALSE, t6);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 2', 'not_started', 'high', '2026-04-06', '2026-04-24', FALSE, t6);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 3', 'not_started', 'high', '2026-04-06', '2026-04-24', FALSE, t6);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 4', 'not_started', 'high', '2026-04-06', '2026-04-24', FALSE, t6);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 5', 'not_started', 'high', '2026-04-06', '2026-04-24', FALSE, t6);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Source commercial antibodies',
            'Material and antibody screening',
            'in_progress', 'critical', '2026-03-25', '2026-04-01', FALSE)
    RETURNING id INTO t7;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t7, id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Survey commercial sources', 'not_started', 'critical', '2026-03-25', '2026-04-01', FALSE, t7);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Order materials', 'not_started', 'critical', '2026-03-25', '2026-04-01', FALSE, t7);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Chris Bagley';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Test combinations in 1/2 strip',
            'Material and antibody screening',
            'not_started', 'high', '2026-04-27', '2026-05-14', FALSE)
    RETURNING id INTO t8;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t8, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t8, id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Com. 1', 'not_started', 'high', '2026-04-27', '2026-05-14', FALSE, t8);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Com. 2', 'not_started', 'high', '2026-04-27', '2026-05-14', FALSE, t8);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Com. 3', 'not_started', 'high', '2026-04-27', '2026-05-14', FALSE, t8);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Com. 4', 'not_started', 'high', '2026-04-27', '2026-05-14', FALSE, t8);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Com. 5', 'not_started', 'high', '2026-04-27', '2026-05-14', FALSE, t8);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Combination report and decision',
            'Material and antibody screening',
            'not_started', 'normal', '2026-05-15', '2026-05-15', TRUE)
    RETURNING id INTO t9;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t9, id FROM users WHERE full_name = 'Kevin Jones';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t9, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t9, id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Membrane studies in composite samples',
            'Material and antibody screening',
            'not_started', 'high', '2026-05-18', '2026-06-19', FALSE)
    RETURNING id INTO t10;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t10, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t10, id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Membrane 1', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t10);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Membrane 2', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t10);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Membrane 3', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t10);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Membrane 4', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t10);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Membrane 5', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t10);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Membrane 6', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t10);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Drying studies',
            'Material and antibody screening',
            'in_progress', 'high', '2026-05-18', '2026-06-19', FALSE)
    RETURNING id INTO t11;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t11, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t11, id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 1', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 2', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 3', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 4', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 5', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 6', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 7', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 8', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 9', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Study 10', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t11);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Running buffer studies',
            'Material and antibody screening',
            'in_progress', 'high', '2026-05-18', '2026-06-19', FALSE)
    RETURNING id INTO t12;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t12, id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t12, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Buffer 1', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t12);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Buffer 2', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t12);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Buffer 3', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t12);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Buffer 4', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t12);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Buffer 5', 'not_started', 'high', '2026-05-18', '2026-06-19', FALSE, t12);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Saliva collection and use',
            'Material and antibody screening',
            'not_started', 'high', '2026-06-22', '2026-07-17', FALSE)
    RETURNING id INTO t13;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t13, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t13, id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Collection', 'not_started', 'high', '2026-06-22', '2026-07-17', FALSE, t13);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Filtration method 1', 'not_started', 'high', '2026-06-22', '2026-07-17', FALSE, t13);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Filtration method 2', 'not_started', 'high', '2026-06-22', '2026-07-17', FALSE, t13);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Test use 1', 'not_started', 'high', '2026-06-22', '2026-07-17', FALSE, t13);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Test use 2', 'not_started', 'high', '2026-06-22', '2026-07-17', FALSE, t13);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Lab prototype/process finalized',
            'Material and antibody screening',
            'not_started', 'critical', '2026-07-20', '2026-07-20', TRUE)
    RETURNING id INTO t14;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t14, id FROM users WHERE full_name = 'Kaytlyn Crowe';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t14, id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t14, id FROM users WHERE full_name = 'Kevin Jones';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Finalize Development Prototype',
            'Material and antibody screening',
            'not_started', 'critical', '2026-07-21', '2026-07-21', TRUE)
    RETURNING id INTO t15;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t15, id FROM users WHERE full_name = 'Kevin Jones';


    -- ---- Analytical validation ----
    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'LOD',
            'Analytical validation',
            'not_started', 'normal', '2026-07-22', '2026-07-22', FALSE)
    RETURNING id INTO t16;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t16, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t16, id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Dose response',
            'Analytical validation',
            'not_started', 'normal', '2026-07-22', '2026-07-27', FALSE)
    RETURNING id INTO t17;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t17, id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t17, id FROM users WHERE full_name = 'Andrew Dimis';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Analytical range',
            'Analytical validation',
            'not_started', 'normal', '2026-07-22', '2026-07-27', FALSE)
    RETURNING id INTO t18;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t18, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t18, id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Quantitative range',
            'Analytical validation',
            'not_started', 'normal', '2026-07-22', '2026-07-27', FALSE)
    RETURNING id INTO t19;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t19, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t19, id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Sample volume studies',
            'Analytical validation',
            'not_started', 'normal', '2026-07-22', '2026-07-27', FALSE)
    RETURNING id INTO t20;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t20, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t20, id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Run time',
            'Analytical validation',
            'not_started', 'normal', '2026-07-22', '2026-07-27', FALSE)
    RETURNING id INTO t21;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t21, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t21, id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Stability',
            'Analytical validation',
            'not_started', 'normal', '2026-07-22', '2027-01-13', FALSE)
    RETURNING id INTO t22;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t22, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t22, id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Produce stability lot', 'not_started', 'normal', '2026-07-22', '2027-01-13', FALSE, t22);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Store at ambient 35C and 45C', 'not_started', 'normal', '2026-07-22', '2027-01-13', FALSE, t22);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Test bi-weekly on composite samples', 'not_started', 'normal', '2026-07-22', '2027-01-13', FALSE, t22);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Patricia Walker';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Multi-lot testing',
            'Analytical validation',
            'not_started', 'normal', '2026-07-27', '2026-08-14', FALSE)
    RETURNING id INTO t23;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t23, id FROM users WHERE full_name = 'Andrew Dimis';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t23, id FROM users WHERE full_name = 'Patricia Walker';


    -- ---- Documentation and report ----
    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'BOM (Dev Prototype)',
            'Documentation and report',
            'not_started', 'normal', '2026-07-22', '2026-07-22', FALSE)
    RETURNING id INTO t24;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t24, id FROM users WHERE full_name = 'Kevin Jones';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Development report',
            'Documentation and report',
            'not_started', 'normal', '2026-08-17', '2026-08-25', FALSE)
    RETURNING id INTO t25;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t25, id FROM users WHERE full_name = 'Kevin Jones';
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t25, id FROM users WHERE full_name = 'Chris Bagley';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Manufacturing SOPs (Dev Prototype)',
            'Documentation and report',
            'not_started', 'normal', '2026-08-17', '2026-08-25', FALSE)
    RETURNING id INTO t26;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t26, id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Conjugation procedures', 'not_started', 'normal', '2026-08-17', '2026-08-25', FALSE, t26);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Membrane striping', 'not_started', 'normal', '2026-08-17', '2026-08-25', FALSE, t26);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Conjugate pad', 'not_started', 'normal', '2026-08-17', '2026-08-25', FALSE, t26);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Chris Bagley';
    INSERT INTO tasks (project_id, created_by, title, status, priority, planned_start, planned_end, is_milestone, parent_task_id)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Assembly', 'not_started', 'normal', '2026-08-17', '2026-08-25', FALSE, t26);
    INSERT INTO task_assignees (task_id, user_id)
    SELECT currval('tasks_id_seq'), id FROM users WHERE full_name = 'Chris Bagley';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'QC testing and release criteria (Dev Prototype)',
            'Documentation and report',
            'not_started', 'normal', '2026-08-17', '2026-08-20', FALSE)
    RETURNING id INTO t27;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t27, id FROM users WHERE full_name = 'Kaytlyn Crowe';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Updated risk analysis',
            'Documentation and report',
            'not_started', 'normal', '2026-08-26', '2026-08-31', FALSE)
    RETURNING id INTO t28;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t28, id FROM users WHERE full_name = 'Chris Bagley';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Product specification (Dev Prototype)',
            'Documentation and report',
            'not_started', 'normal', '2026-09-01', '2026-09-02', TRUE)
    RETURNING id INTO t29;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t29, id FROM users WHERE full_name = 'Kevin Jones';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Trace matrix (PRD vs Dev specification)',
            'Documentation and report',
            'not_started', 'normal', '2026-09-03', '2026-09-03', FALSE)
    RETURNING id INTO t30;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t30, id FROM users WHERE full_name = 'Kaytlyn Crowe';

    INSERT INTO tasks (project_id, created_by, title, description, status, priority, planned_start, planned_end, is_milestone)
    VALUES (v_project_id,
            (SELECT id FROM users WHERE email='cb@metabolictrack.com'),
            'Design review Phase 1',
            'Documentation and report',
            'not_started', 'normal', '2026-09-04', '2026-09-04', TRUE)
    RETURNING id INTO t31;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t31, id FROM users WHERE full_name = 'Kaytlyn Crowe';


END $$;

-- Verification query
SELECT COUNT(*) AS total_tasks FROM tasks WHERE project_id = (SELECT id FROM projects WHERE code = 'CORT-P1');