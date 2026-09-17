-- =============================================================
-- Lab Project Management System — PostgreSQL Schema v2
-- Updated from screenshot review — June 2026
-- Run against your existing PostgreSQL instance:
--   psql -U <user> -d <your_db> -f schema.sql
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
-- ENUMS
-- =============================================================

CREATE TYPE user_role AS ENUM (
    'lab_tech',
    'ops_manager',
    'qm_director',
    'ceo'
);

-- Updated from screenshots: New order, In progress, Emailed items,
-- Stuck, Received, Invoiced, Complete/Closed + internal Pending/Rejected
CREATE TYPE po_status AS ENUM (
    'pending',              -- submitted internally, awaiting approval
    'rejected',             -- rejected by ops manager
    'new_order',            -- approved, not yet sent to supplier
    'emailed',              -- order emailed/sent to supplier
    'in_progress',          -- supplier confirmed, being processed
    'stuck',                -- blocked — awaiting response or action
    'received',             -- goods received (full or partial)
    'invoiced',             -- invoice received, pending payment
    'closed'                -- paid and complete
);

CREATE TYPE payment_status AS ENUM (
    'unpaid',
    'partially_paid',
    'paid',
    'overdue'
);

-- Updated: Low / Medium / High / Critical
CREATE TYPE risk_level AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);

CREATE TYPE priority_level AS ENUM (
    'low',
    'normal',
    'high',
    'critical'
);

CREATE TYPE task_status AS ENUM (
    'not_started',
    'in_progress',
    'blocked',
    'complete'
);

CREATE TYPE consumable_category AS ENUM (
    'reagent',
    'antibody',
    'buffer',
    'antigen',
    'conjugate',
    'nanoparticle',
    'membrane',
    'packaging',
    'equipment',
    'general'
);

CREATE TYPE consumable_unit AS ENUM (
    'each',
    'box',
    'case',
    'pack',
    'liter',
    'milliliter',
    'gram',
    'kilogram',
    'meter',
    'roll',
    'pair',
    'set'
);

-- =============================================================
-- USERS
-- =============================================================

CREATE TABLE users (
    id                  SERIAL PRIMARY KEY,
    full_name           VARCHAR(120)    NOT NULL,
    email               VARCHAR(255)    NOT NULL UNIQUE,
    hashed_password     TEXT            NOT NULL,
    role                user_role       NOT NULL,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- PROJECTS
-- =============================================================

CREATE TABLE projects (
    id                  SERIAL PRIMARY KEY,
    code                VARCHAR(30)     NOT NULL UNIQUE,
    name                VARCHAR(200)    NOT NULL,
    description         TEXT,
    client              VARCHAR(200),
    start_date          DATE,
    end_date            DATE,
    budget_allocated    NUMERIC(12,2)   DEFAULT 0,
    budget_alert_threshold NUMERIC(5,2) DEFAULT 80.00,            -- alert when % spent hits this
    hourly_rate         NUMERIC(8,2)    DEFAULT 0,                 -- labour rate for this project
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_by          INTEGER         REFERENCES users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- SUPPLIERS
-- =============================================================

CREATE TABLE suppliers (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(200)    NOT NULL,
    code                VARCHAR(20),                    -- short code e.g. BBI, SGA
    contact_name        VARCHAR(120),
    phone               VARCHAR(40),
    email               VARCHAR(255),
    address             TEXT,
    website             VARCHAR(255),
    notes               TEXT,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier_categories (
    id                  SERIAL PRIMARY KEY,
    supplier_id         INTEGER         NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    category            VARCHAR(100)    NOT NULL
);

-- Credentials — visible to ops_manager and qm_director only
CREATE TABLE supplier_credentials (
    id                  SERIAL PRIMARY KEY,
    supplier_id         INTEGER         NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE UNIQUE,
    portal_url          VARCHAR(255),
    username            VARCHAR(200),
    encrypted_password  TEXT,           -- Fernet-encrypted by FastAPI before insert
    portal_email        VARCHAR(255),
    account_number      VARCHAR(100),
    notes               TEXT,
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- PURCHASE ORDERS
-- =============================================================

CREATE TABLE purchase_orders (
    id                  SERIAL PRIMARY KEY,
    po_number           VARCHAR(30)     UNIQUE,             -- e.g. PO-2026-0042, assigned on approval
    project_id          INTEGER         NOT NULL REFERENCES projects(id),
    supplier_id         INTEGER         REFERENCES suppliers(id),
    supplier_name_free  VARCHAR(200),                       -- one-off supplier not in list
    requested_by        INTEGER         NOT NULL REFERENCES users(id),
    approved_by         INTEGER         REFERENCES users(id),
    receiver_id         INTEGER         REFERENCES users(id), -- who received the goods
    status              po_status       NOT NULL DEFAULT 'pending',
    priority            priority_level  NOT NULL DEFAULT 'normal',
    risk_level          risk_level,                         -- Low / Medium / High / Critical
    urgency             VARCHAR(20)     NOT NULL DEFAULT 'normal', -- requester's urgency, separate from approver-set priority
    notes               TEXT,
    rejection_reason    TEXT,
    expected_delivery   DATE,
    placed_date         DATE,
    received_date       DATE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT supplier_required CHECK (
        supplier_id IS NOT NULL OR supplier_name_free IS NOT NULL
    )
);

-- Line items — one row per product on the PO
CREATE TABLE po_line_items (
    id                  SERIAL PRIMARY KEY,
    po_id               INTEGER         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    description         VARCHAR(300)    NOT NULL,
    product_id          VARCHAR(100),                       -- supplier's product/catalog ID e.g. EM.GC40
    product_url         TEXT,                               -- direct link to item on supplier site
    quantity_ordered    NUMERIC(10,3)   NOT NULL,
    unit                consumable_unit NOT NULL DEFAULT 'each',
    unit_cost_estimate  NUMERIC(10,2),
    unit_cost_actual    NUMERIC(10,2),                      -- confirmed on receipt / invoice
    consumable_id       INTEGER         REFERENCES consumables(id), -- linked if restocking inventory
    notes               TEXT
);

-- Receipt events — supports partial deliveries
CREATE TABLE po_receipts (
    id                  SERIAL PRIMARY KEY,
    po_id               INTEGER         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_item_id        INTEGER         REFERENCES po_line_items(id),
    received_by         INTEGER         NOT NULL REFERENCES users(id),
    quantity_received   NUMERIC(10,3)   NOT NULL,
    received_date       DATE            NOT NULL DEFAULT CURRENT_DATE,
    notes               TEXT
);

-- General file attachments per PO (quotes, specs, safety sheets, etc.)
CREATE TABLE po_attachments (
    id                  SERIAL PRIMARY KEY,
    po_id               INTEGER         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    file_name           VARCHAR(255)    NOT NULL,
    file_path           TEXT            NOT NULL,           -- path on disk
    file_type           VARCHAR(50),                        -- mime type
    uploaded_by         INTEGER         NOT NULL REFERENCES users(id),
    uploaded_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    notes               TEXT
);

-- Status change audit trail
CREATE TABLE po_status_history (
    id                  SERIAL PRIMARY KEY,
    po_id               INTEGER         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    changed_by          INTEGER         NOT NULL REFERENCES users(id),
    old_status          po_status,
    new_status          po_status       NOT NULL,
    notes               TEXT,
    changed_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- INVOICES & PAYMENTS
-- =============================================================

CREATE TABLE invoices (
    id                  SERIAL PRIMARY KEY,
    po_id               INTEGER         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    invoice_number      VARCHAR(100)    NOT NULL,
    invoice_date        DATE            NOT NULL,
    due_date            DATE,
    amount_invoiced     NUMERIC(12,2)   NOT NULL,
    amount_paid         NUMERIC(12,2)   NOT NULL DEFAULT 0,
    payment_status      payment_status  NOT NULL DEFAULT 'unpaid',
    payment_date        DATE,
    payment_reference   VARCHAR(200),
    file_path           TEXT,                               -- uploaded invoice PDF
    uploaded_by         INTEGER         REFERENCES users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- CONSUMABLES INVENTORY
-- =============================================================

CREATE TABLE consumables (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(200)    NOT NULL,
    description         TEXT,
    category            consumable_category NOT NULL DEFAULT 'reagent',
    project_id          INTEGER         REFERENCES projects(id),  -- NULL = shared across projects
    is_shared           BOOLEAN         NOT NULL DEFAULT FALSE,
    sku                 VARCHAR(100),
    unit                consumable_unit NOT NULL DEFAULT 'each',
    current_stock       NUMERIC(10,3)   NOT NULL DEFAULT 0,
    reorder_threshold   NUMERIC(10,3)   NOT NULL DEFAULT 0,
    reorder_quantity    NUMERIC(10,3),
    unit_cost           NUMERIC(10,2),
    preferred_supplier_id INTEGER       REFERENCES suppliers(id),
    location            VARCHAR(100),
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    last_restocked      DATE,
    auto_reorder        BOOLEAN         NOT NULL DEFAULT TRUE,  -- auto-draft PO when threshold hit
    reorder_po_drafted  BOOLEAN         NOT NULL DEFAULT FALSE, -- prevents duplicate draft POs
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE consumable_transactions (
    id                  SERIAL PRIMARY KEY,
    consumable_id       INTEGER         NOT NULL REFERENCES consumables(id),
    user_id             INTEGER         NOT NULL REFERENCES users(id),
    project_id          INTEGER         REFERENCES projects(id),
    daily_log_id        INTEGER,
    quantity_change     NUMERIC(10,3)   NOT NULL,           -- negative = used, positive = restocked
    transaction_type    VARCHAR(30)     NOT NULL,           -- 'usage' | 'restock' | 'adjustment'
    notes               TEXT,
    transaction_date    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- EMPLOYEE DAILY LOGS
-- =============================================================

-- A daily log is one submission per user per day.
-- Each log can have multiple project entries (one per project worked on).
CREATE TABLE daily_logs (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER         NOT NULL REFERENCES users(id),
    log_date            DATE            NOT NULL DEFAULT CURRENT_DATE,
    submitted_at        TIMESTAMPTZ,                               -- NULL = still in draft
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, log_date)                                     -- one log per person per day
);

-- Each project entry within a daily log
CREATE TABLE daily_log_entries (
    id                  SERIAL PRIMARY KEY,
    log_id              INTEGER         NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
    project_id          INTEGER         NOT NULL REFERENCES projects(id),
    hours_spent         NUMERIC(4,2)    NOT NULL,
    hourly_rate         NUMERIC(8,2),                              -- snapshot rate at time of log

    -- Structured progress notes
    work_completed      TEXT,                                      -- "What I did"
    issues_blockers     TEXT,                                      -- "Issues / blockers"
    next_steps          TEXT,                                      -- "Next steps"
    additional_notes    TEXT,                                      -- optional free text

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (log_id, project_id)                                    -- one entry per project per daily log
);

-- Task references within a log entry — tech picks tasks and adds per-task notes
-- Can also update task status (mark complete or flag as blocked) directly from the log
CREATE TABLE daily_log_entry_tasks (
    id                  SERIAL PRIMARY KEY,
    log_entry_id        INTEGER         NOT NULL REFERENCES daily_log_entries(id) ON DELETE CASCADE,
    task_id             INTEGER         NOT NULL REFERENCES tasks(id),
    notes               TEXT,                                      -- per-task progress note
    status_update       task_status,                               -- NULL = no change, set to update
    UNIQUE (log_entry_id, task_id)
);

CREATE INDEX idx_log_entry_tasks_entry ON daily_log_entry_tasks(log_entry_id);
CREATE INDEX idx_log_entry_tasks_task  ON daily_log_entry_tasks(task_id);

-- consumable_transactions links to the specific project entry, not the top-level log
-- Missing log tracking — populated by a scheduled job each morning at 10am
-- Flags any lab tech who has not submitted their previous day's log
CREATE TABLE missing_log_flags (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER         NOT NULL REFERENCES users(id),
    missing_date        DATE            NOT NULL,
    flagged_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    resolved            BOOLEAN         NOT NULL DEFAULT FALSE,
    resolved_at         TIMESTAMPTZ,
    UNIQUE (user_id, missing_date)
);

-- In-app notification log for missing log alerts
CREATE TABLE notifications (
    id                  SERIAL PRIMARY KEY,
    recipient_id        INTEGER         NOT NULL REFERENCES users(id),
    notification_type   VARCHAR(50)     NOT NULL,                  -- 'missing_log' | 'reorder_po' | 'po_approved' etc.
    title               VARCHAR(200)    NOT NULL,
    message             TEXT,
    reference_id        INTEGER,                                   -- e.g. daily_log id, po id
    reference_type      VARCHAR(50),                               -- 'daily_log' | 'purchase_order' etc.
    is_read             BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX idx_notifications_read      ON notifications(recipient_id, is_read);
CREATE INDEX idx_missing_log_user        ON missing_log_flags(user_id);
CREATE INDEX idx_missing_log_date        ON missing_log_flags(missing_date);

ALTER TABLE consumable_transactions
    ADD CONSTRAINT fk_consumable_daily_log
    FOREIGN KEY (daily_log_id) REFERENCES daily_log_entries(id);

-- =============================================================
-- TASK TRACKER
-- =============================================================

CREATE TABLE tasks (
    id                  SERIAL PRIMARY KEY,
    project_id          INTEGER         NOT NULL REFERENCES projects(id),
    -- assigned_to removed: use task_assignees junction table for multi-assignee support
    created_by          INTEGER         REFERENCES users(id),
    task_group          VARCHAR(200),                        -- section/group label e.g. 'Material and antibody screening'
    title               VARCHAR(300)    NOT NULL,
    description         TEXT,
    status              task_status     NOT NULL DEFAULT 'not_started',
    priority            priority_level  NOT NULL DEFAULT 'normal',
    planned_start       DATE,
    planned_end         DATE,
    actual_start        DATE,
    actual_end          DATE,
    is_milestone        BOOLEAN         NOT NULL DEFAULT FALSE,
    parent_task_id      INTEGER         REFERENCES tasks(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE task_history (
    id                  SERIAL PRIMARY KEY,
    task_id             INTEGER         NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    changed_by          INTEGER         NOT NULL REFERENCES users(id),
    old_status          task_status,
    new_status          task_status     NOT NULL,
    notes               TEXT,
    changed_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- =============================================================
-- KPI TRACKING
-- Visible to: ops_manager only (ceo excluded per permissions)
-- =============================================================

CREATE TYPE kpi_period AS ENUM ('weekly', 'monthly');

CREATE TYPE kpi_metric_type AS ENUM (
    'task_completion_rate',     -- % of planned tasks completed in period
    'hours_logged',             -- total hours logged per employee per period
    'log_submission_rate',      -- % of working days with submitted log
    'on_time_task_completion',  -- % of completed tasks finished by planned_end
    'custom'                    -- ops manager defined
);

-- KPI definitions — ops manager creates these, can add custom ones at any time
CREATE TABLE kpi_targets (
    id                  SERIAL PRIMARY KEY,
    metric_type         kpi_metric_type NOT NULL DEFAULT 'custom',
    metric_name         VARCHAR(200)    NOT NULL,               -- display name
    description         TEXT,                                   -- what this KPI measures
    user_id             INTEGER         REFERENCES users(id),   -- NULL = applies to all lab techs
    project_id          INTEGER         REFERENCES projects(id),-- NULL = applies to all projects
    target_value        NUMERIC(10,2)   NOT NULL,               -- e.g. 90 for 90%
    unit                VARCHAR(50)     NOT NULL DEFAULT '%',   -- %, hours, tasks
    period              kpi_period      NOT NULL DEFAULT 'weekly',
    is_system           BOOLEAN         NOT NULL DEFAULT FALSE, -- TRUE = auto-computed, FALSE = manual
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    effective_from      DATE            NOT NULL DEFAULT CURRENT_DATE,
    effective_to        DATE,
    created_by          INTEGER         NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kpi_targets_user    ON kpi_targets(user_id);
CREATE INDEX idx_kpi_targets_project ON kpi_targets(project_id);
CREATE INDEX idx_kpi_targets_active  ON kpi_targets(is_active);

-- KPI actuals — computed by fn_compute_kpi_actuals(), stored for history + trending
CREATE TABLE kpi_actuals (
    id                  SERIAL PRIMARY KEY,
    kpi_target_id       INTEGER         NOT NULL REFERENCES kpi_targets(id) ON DELETE CASCADE,
    user_id             INTEGER         REFERENCES users(id),
    project_id          INTEGER         REFERENCES projects(id),
    period_start        DATE            NOT NULL,
    period_end          DATE            NOT NULL,
    actual_value        NUMERIC(10,2)   NOT NULL,
    target_value        NUMERIC(10,2)   NOT NULL,               -- snapshot of target at time of measurement
    met_target          BOOLEAN         GENERATED ALWAYS AS (actual_value >= target_value) STORED,
    notes               TEXT,
    computed_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (kpi_target_id, user_id, project_id, period_start)
);

CREATE INDEX idx_kpi_actuals_target  ON kpi_actuals(kpi_target_id);
CREATE INDEX idx_kpi_actuals_user    ON kpi_actuals(user_id);
CREATE INDEX idx_kpi_actuals_period  ON kpi_actuals(period_start, period_end);
CREATE INDEX idx_kpi_actuals_met     ON kpi_actuals(met_target);

-- Consumables dropdown — all active items for end-of-day usage log UI
-- Returns every active consumable with supplier name for display
CREATE VIEW consumables_dropdown AS
SELECT
    c.id,
    c.name,
    c.sku,
    c.category,
    c.unit,
    c.current_stock,
    c.reorder_threshold,
    c.is_shared,
    p.code          AS project_code,
    s.name          AS preferred_supplier
FROM consumables c
LEFT JOIN projects p  ON p.id = c.project_id
LEFT JOIN suppliers s ON s.id = c.preferred_supplier_id
WHERE c.is_active = TRUE
ORDER BY c.category, c.name;

-- =============================================================
-- BUDGET TRACKER
-- =============================================================

-- Phase budgets — a project can have multiple phases each with their own budget
-- e.g. Phase 1 Development, Phase 2 Validation, each with separate allocations
CREATE TABLE project_phases (
    id                  SERIAL PRIMARY KEY,
    project_id          INTEGER         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_name          VARCHAR(200)    NOT NULL,               -- e.g. 'Phase 1 - Development'
    phase_number        INTEGER         NOT NULL DEFAULT 1,
    budget_allocated    NUMERIC(12,2)   NOT NULL DEFAULT 0,
    hourly_rate         NUMERIC(8,2),                           -- override project rate for this phase
    budget_alert_threshold NUMERIC(5,2) DEFAULT 80.00,
    start_date          DATE,
    end_date            DATE,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, phase_number)
);

CREATE INDEX idx_phase_project ON project_phases(project_id);

-- Budget entries — every cost event auto-posted from POs, daily logs, consumable usage
CREATE TABLE budget_entries (
    id                  SERIAL PRIMARY KEY,
    project_id          INTEGER         NOT NULL REFERENCES projects(id),
    phase_id            INTEGER         REFERENCES project_phases(id), -- NULL = not phase-specific
    entry_type          VARCHAR(30)     NOT NULL,               -- 'labour' | 'consumable' | 'purchase_order'
    reference_id        INTEGER,                                -- FK to source record
    reference_type      VARCHAR(50),                            -- 'daily_log_entry' | 'consumable_transaction' | 'invoice'
    description         VARCHAR(300),
    amount              NUMERIC(12,2)   NOT NULL,
    entry_date          DATE            NOT NULL DEFAULT CURRENT_DATE,
    created_by          INTEGER         REFERENCES users(id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_budget_project   ON budget_entries(project_id);
CREATE INDEX idx_budget_phase     ON budget_entries(phase_id);
CREATE INDEX idx_budget_type      ON budget_entries(entry_type);
CREATE INDEX idx_budget_date      ON budget_entries(entry_date);
CREATE INDEX idx_budget_ref       ON budget_entries(reference_type, reference_id);

-- =============================================================
-- WEEKLY REPORTS
-- =============================================================

CREATE TYPE report_status AS ENUM (
    'draft',        -- auto-generated, awaiting ops manager review
    'published',    -- ops manager has reviewed and distributed
    'archived'      -- older reports moved to archive
);

CREATE TABLE weekly_reports (
    id                  SERIAL PRIMARY KEY,
    week_start          DATE            NOT NULL,
    week_end            DATE            NOT NULL,
    status              report_status   NOT NULL DEFAULT 'draft',
    generated_by        INTEGER         NOT NULL REFERENCES users(id),
    generated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    -- Ops manager editable fields before publishing
    executive_summary   TEXT,                                      -- written by ops manager before distribution
    published_by        INTEGER         REFERENCES users(id),
    published_at        TIMESTAMPTZ,
    file_path           TEXT,                                      -- path to final PDF on disk
    draft_file_path     TEXT,                                      -- path to draft PDF (auto-generated)
    UNIQUE (week_start)
);

-- Per-project sections within the report
-- One row per active project, populated automatically on generation
CREATE TABLE weekly_report_sections (
    id                  SERIAL PRIMARY KEY,
    report_id           INTEGER         NOT NULL REFERENCES weekly_reports(id) ON DELETE CASCADE,
    project_id          INTEGER         NOT NULL REFERENCES projects(id),
    sort_order          INTEGER         NOT NULL DEFAULT 0,

    -- Employee log summary (auto-populated)
    total_hours         NUMERIC(6,2)    DEFAULT 0,
    log_summary         TEXT,                                      -- auto-generated narrative of work done
    missing_logs        TEXT,                                      -- names of any techs with missing logs

    -- Consumables summary (auto-populated)
    consumables_used    TEXT,                                      -- JSON snapshot of items + quantities
    restock_flags       TEXT,                                      -- items flagged for reorder this week

    -- Budget summary (auto-populated)
    budget_allocated    NUMERIC(12,2),
    budget_spent_week   NUMERIC(12,2),
    budget_spent_total  NUMERIC(12,2),
    budget_remaining    NUMERIC(12,2),

    -- PO activity (auto-populated)
    po_summary          TEXT,                                      -- JSON snapshot of PO activity

    -- Gantt snapshot (auto-populated)
    tasks_completed     INTEGER         DEFAULT 0,
    tasks_in_progress   INTEGER         DEFAULT 0,
    tasks_blocked       INTEGER         DEFAULT 0,
    tasks_not_started   INTEGER         DEFAULT 0,
    gantt_snapshot_path TEXT,                                      -- path to gantt image exported for this week

    -- Ops manager can add per-project notes
    ops_notes           TEXT,

    UNIQUE (report_id, project_id)
);

CREATE INDEX idx_report_sections_report  ON weekly_report_sections(report_id);
CREATE INDEX idx_report_sections_project ON weekly_report_sections(project_id);
CREATE INDEX idx_weekly_reports_status   ON weekly_reports(status);
CREATE INDEX idx_weekly_reports_week     ON weekly_reports(week_start);

-- End-of-day bulk usage log — lab techs submit all consumable usage at once
-- Each entry links to the daily_log for that day
-- Consumable usage submission links to a specific project entry in the daily log
CREATE TABLE consumable_daily_usage (
    id                  SERIAL PRIMARY KEY,
    log_entry_id        INTEGER         NOT NULL REFERENCES daily_log_entries(id) ON DELETE CASCADE,
    user_id             INTEGER         NOT NULL REFERENCES users(id),
    project_id          INTEGER         NOT NULL REFERENCES projects(id),
    log_date            DATE            NOT NULL DEFAULT CURRENT_DATE,
    submitted_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    notes               TEXT,
    UNIQUE (log_entry_id)                                          -- one usage submission per project entry
);

-- Line items within each end-of-day submission
-- consumable_id is unrestricted — techs select from ALL active consumables
-- regardless of whether the item is shared or project-specific.
-- Usage is tagged to the project via the parent consumable_daily_usage row.
CREATE TABLE consumable_daily_usage_items (
    id                  SERIAL PRIMARY KEY,
    usage_id            INTEGER         NOT NULL REFERENCES consumable_daily_usage(id) ON DELETE CASCADE,
    consumable_id       INTEGER         NOT NULL REFERENCES consumables(id),
    quantity_used       NUMERIC(10,3)   NOT NULL,
    notes               TEXT
);

CREATE INDEX idx_daily_usage_user    ON consumable_daily_usage(user_id);
CREATE INDEX idx_daily_usage_project ON consumable_daily_usage(project_id);
CREATE INDEX idx_daily_usage_date    ON consumable_daily_usage(log_date);
CREATE INDEX idx_daily_usage_items   ON consumable_daily_usage_items(consumable_id);

-- =============================================================
-- INDEXES
-- =============================================================

CREATE INDEX idx_users_role              ON users(role);
CREATE INDEX idx_users_email             ON users(email);
CREATE INDEX idx_projects_code           ON projects(code);
CREATE INDEX idx_projects_active         ON projects(is_active);
CREATE INDEX idx_po_status               ON purchase_orders(status);
CREATE INDEX idx_po_project              ON purchase_orders(project_id);
CREATE INDEX idx_po_supplier             ON purchase_orders(supplier_id);
CREATE INDEX idx_po_requested_by         ON purchase_orders(requested_by);
CREATE INDEX idx_po_risk                 ON purchase_orders(risk_level);
CREATE INDEX idx_po_priority             ON purchase_orders(priority);
CREATE INDEX idx_po_line_product_id      ON po_line_items(product_id);
CREATE INDEX idx_po_status_history_po    ON po_status_history(po_id);
CREATE INDEX idx_consumables_stock       ON consumables(current_stock);
CREATE INDEX idx_consumable_txn_date     ON consumable_transactions(transaction_date);
CREATE INDEX idx_consumable_txn_proj     ON consumable_transactions(project_id);
CREATE INDEX idx_daily_log_user          ON daily_logs(user_id);
CREATE INDEX idx_daily_log_date          ON daily_logs(log_date);
CREATE INDEX idx_daily_log_entry_log     ON daily_log_entries(log_id);
CREATE INDEX idx_daily_log_entry_project ON daily_log_entries(project_id);
CREATE INDEX idx_tasks_project           ON tasks(project_id);
CREATE INDEX idx_tasks_assigned          ON tasks(assigned_to);
CREATE INDEX idx_tasks_status            ON tasks(status);
CREATE INDEX idx_tasks_dates             ON tasks(planned_start, planned_end);
-- CREATE INDEX idx_budget_project          ON budget_entries(project_id); (defined inline above)
-- CREATE INDEX idx_budget_type             ON budget_entries(entry_type); (defined inline above)
-- CREATE INDEX idx_budget_date             ON budget_entries(entry_date); (defined inline above)
CREATE INDEX idx_kpi_user                ON kpi_actuals(user_id);
CREATE INDEX idx_kpi_period              ON kpi_actuals(period_start, period_end);
CREATE INDEX idx_invoice_po              ON invoices(po_id);
CREATE INDEX idx_invoice_payment         ON invoices(payment_status);
CREATE INDEX idx_suppliers_code          ON suppliers(code);

-- =============================================================
-- UPDATED_AT TRIGGER
-- =============================================================

-- Auto-update task status when a tech marks it from their daily log
CREATE OR REPLACE FUNCTION fn_log_entry_task_status_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status_update IS NOT NULL THEN
        -- Update the task status
        UPDATE tasks
        SET status = NEW.status_update,
            actual_end = CASE WHEN NEW.status_update = 'complete' THEN CURRENT_DATE ELSE actual_end END,
            actual_start = CASE WHEN NEW.status_update = 'in_progress' AND actual_start IS NULL THEN CURRENT_DATE ELSE actual_start END
        WHERE id = NEW.task_id;

        -- Write to task history
        INSERT INTO task_history (task_id, changed_by, old_status, new_status, notes)
        SELECT NEW.task_id,
               dl.user_id,
               t.status,
               NEW.status_update,
               'Updated via daily log'
        FROM daily_log_entries dle
        JOIN daily_logs dl ON dl.id = dle.log_id
        JOIN tasks t       ON t.id  = NEW.task_id
        WHERE dle.id = NEW.log_entry_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_entry_task_status
    AFTER INSERT OR UPDATE ON daily_log_entry_tasks
    FOR EACH ROW EXECUTE FUNCTION fn_log_entry_task_status_update();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated        BEFORE UPDATE ON users        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_projects_updated     BEFORE UPDATE ON projects      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_suppliers_updated    BEFORE UPDATE ON suppliers     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_po_updated           BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_updated     BEFORE UPDATE ON invoices      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_consumables_updated  BEFORE UPDATE ON consumables   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_daily_logs_updated   BEFORE UPDATE ON daily_logs    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tasks_updated        BEFORE UPDATE ON tasks         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_daily_log_entry_updated BEFORE UPDATE ON daily_log_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- VIEWS
-- =============================================================



-- =============================================================
-- WEEKLY REPORT AUTO-GENERATION FUNCTION
-- Called by cron every Monday at 6:00am, or manually by ops manager
-- Creates a draft report populated with last week's data
-- Ops manager then adds executive_summary + ops_notes and publishes
-- =============================================================

CREATE OR REPLACE FUNCTION fn_generate_weekly_report(
    p_week_start DATE DEFAULT date_trunc('week', CURRENT_DATE - INTERVAL '7 days')::DATE
)
RETURNS INTEGER AS $$
DECLARE
    v_week_end      DATE := p_week_start + INTERVAL '6 days';
    v_report_id     INTEGER;
    v_generator     INTEGER;
    v_project       RECORD;
    v_section_id    INTEGER;
BEGIN
    -- Get ops manager id
    SELECT id INTO v_generator
    FROM users WHERE role = 'ops_manager' AND is_active = TRUE LIMIT 1;

    -- Create or update the report record
    INSERT INTO weekly_reports (week_start, week_end, status, generated_by)
    VALUES (p_week_start, v_week_end, 'draft', v_generator)
    ON CONFLICT (week_start) DO UPDATE
        SET generated_at = NOW(), status = 'draft'
    RETURNING id INTO v_report_id;

    -- Loop through all active projects
    FOR v_project IN SELECT id, code, name, budget_allocated FROM projects WHERE is_active = TRUE
    LOOP
        -- Upsert section for this project
        INSERT INTO weekly_report_sections (
            report_id, project_id, sort_order,
            total_hours,
            budget_allocated, budget_spent_week, budget_spent_total, budget_remaining,
            tasks_completed, tasks_in_progress, tasks_blocked, tasks_not_started
        )
        VALUES (
            v_report_id,
            v_project.id,
            (SELECT COUNT(*) FROM weekly_report_sections WHERE report_id = v_report_id),

            -- Total hours logged this week for this project
            COALESCE((
                SELECT SUM(dle.hours_spent)
                FROM daily_log_entries dle
                JOIN daily_logs dl ON dl.id = dle.log_id
                WHERE dle.project_id = v_project.id
                  AND dl.log_date BETWEEN p_week_start AND v_week_end
                  AND dl.submitted_at IS NOT NULL
            ), 0),

            -- Budget figures
            v_project.budget_allocated,
            COALESCE((SELECT SUM(amount) FROM budget_entries
                      WHERE project_id = v_project.id
                        AND entry_date BETWEEN p_week_start AND v_week_end), 0),
            COALESCE((SELECT SUM(amount) FROM budget_entries
                      WHERE project_id = v_project.id), 0),
            v_project.budget_allocated - COALESCE((SELECT SUM(amount) FROM budget_entries
                      WHERE project_id = v_project.id), 0),

            -- Task counts
            (SELECT COUNT(*) FROM tasks WHERE project_id = v_project.id AND status = 'complete'),
            (SELECT COUNT(*) FROM tasks WHERE project_id = v_project.id AND status = 'in_progress'),
            (SELECT COUNT(*) FROM tasks WHERE project_id = v_project.id AND status = 'blocked'),
            (SELECT COUNT(*) FROM tasks WHERE project_id = v_project.id AND status = 'not_started')
        )
        ON CONFLICT (report_id, project_id) DO UPDATE SET
            total_hours         = EXCLUDED.total_hours,
            budget_spent_week   = EXCLUDED.budget_spent_week,
            budget_spent_total  = EXCLUDED.budget_spent_total,
            budget_remaining    = EXCLUDED.budget_remaining,
            tasks_completed     = EXCLUDED.tasks_completed,
            tasks_in_progress   = EXCLUDED.tasks_in_progress,
            tasks_blocked       = EXCLUDED.tasks_blocked,
            tasks_not_started   = EXCLUDED.tasks_not_started;

    END LOOP;

    -- Notify ops manager the draft is ready for review
    INSERT INTO notifications (recipient_id, notification_type, title, message, reference_id, reference_type)
    SELECT id, 'weekly_report',
           'Weekly report draft ready — ' || TO_CHAR(p_week_start, 'Mon DD') || ' to ' || TO_CHAR(v_week_end, 'Mon DD, YYYY'),
           'The weekly report has been auto-generated. Please add your executive summary and publish.',
           v_report_id, 'weekly_report'
    FROM users WHERE role = 'ops_manager' AND is_active = TRUE;

    RETURN v_report_id;
END;
$$ LANGUAGE plpgsql;



-- =============================================================
-- KPI AUTO-COMPUTATION FUNCTION
-- Called by cron weekly (Monday 6:30am) and monthly (1st of month 6:30am)
-- Also callable manually by ops manager from the KPI dashboard
-- Computes all system KPIs and stores results in kpi_actuals
-- =============================================================

CREATE OR REPLACE FUNCTION fn_compute_kpi_actuals(
    p_period        kpi_period DEFAULT 'weekly',
    p_period_start  DATE       DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_start         DATE;
    v_end           DATE;
    v_computed      INTEGER := 0;
    v_target        RECORD;
    v_user          RECORD;
    v_project       RECORD;
    v_actual        NUMERIC(10,2);
    v_working_days  INTEGER;
BEGIN
    -- Determine period dates
    IF p_period = 'weekly' THEN
        v_start := COALESCE(p_period_start,
                   date_trunc('week', CURRENT_DATE - INTERVAL '7 days')::DATE);
        v_end   := v_start + INTERVAL '6 days';
    ELSE
        v_start := COALESCE(p_period_start,
                   date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::DATE);
        v_end   := (date_trunc('month', v_start) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    END IF;

    -- Working days in period (Mon-Fri only)
    SELECT COUNT(*) INTO v_working_days
    FROM generate_series(v_start, v_end, '1 day'::INTERVAL) d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

    -- Loop through all active system KPI targets
    FOR v_target IN
        SELECT * FROM kpi_targets
        WHERE is_active = TRUE
          AND is_system = TRUE
          AND period = p_period
          AND effective_from <= v_start
          AND (effective_to IS NULL OR effective_to >= v_end)
    LOOP
        -- Determine scope: specific user/project or all
        FOR v_user IN
            SELECT id, full_name FROM users
            WHERE role = 'lab_tech' AND is_active = TRUE
              AND (v_target.user_id IS NULL OR id = v_target.user_id)
        LOOP
            FOR v_project IN
                SELECT id, code FROM projects
                WHERE is_active = TRUE
                  AND (v_target.project_id IS NULL OR id = v_target.project_id)
            LOOP
                v_actual := 0;

                -- Compute based on metric type
                CASE v_target.metric_type

                    WHEN 'task_completion_rate' THEN
                        -- % of tasks assigned to user on project completed this period
                        SELECT CASE WHEN COUNT(*) = 0 THEN 0
                               ELSE ROUND(
                                   SUM(CASE WHEN t.status = 'complete' THEN 1 ELSE 0 END)::NUMERIC
                                   / COUNT(*) * 100, 1)
                               END
                        INTO v_actual
                        FROM tasks t
                        JOIN task_assignees ta ON ta.task_id = t.id
                        WHERE ta.user_id = v_user.id
                          AND t.project_id = v_project.id
                          AND t.planned_end BETWEEN v_start AND v_end;

                    WHEN 'hours_logged' THEN
                        -- Total hours logged by user on project this period
                        SELECT COALESCE(SUM(dle.hours_spent), 0)
                        INTO v_actual
                        FROM daily_log_entries dle
                        JOIN daily_logs dl ON dl.id = dle.log_id
                        WHERE dl.user_id = v_user.id
                          AND dle.project_id = v_project.id
                          AND dl.log_date BETWEEN v_start AND v_end
                          AND dl.submitted_at IS NOT NULL;

                    WHEN 'log_submission_rate' THEN
                        -- % of working days where user submitted a log
                        SELECT CASE WHEN v_working_days = 0 THEN 0
                               ELSE ROUND(
                                   COUNT(DISTINCT dl.log_date)::NUMERIC
                                   / v_working_days * 100, 1)
                               END
                        INTO v_actual
                        FROM daily_logs dl
                        WHERE dl.user_id = v_user.id
                          AND dl.log_date BETWEEN v_start AND v_end
                          AND dl.submitted_at IS NOT NULL;

                    WHEN 'on_time_task_completion' THEN
                        -- % of completed tasks finished on or before planned_end
                        SELECT CASE WHEN COUNT(*) = 0 THEN 0
                               ELSE ROUND(
                                   SUM(CASE WHEN t.actual_end <= t.planned_end THEN 1 ELSE 0 END)::NUMERIC
                                   / COUNT(*) * 100, 1)
                               END
                        INTO v_actual
                        FROM tasks t
                        JOIN task_assignees ta ON ta.task_id = t.id
                        WHERE ta.user_id = v_user.id
                          AND t.project_id = v_project.id
                          AND t.status = 'complete'
                          AND t.actual_end BETWEEN v_start AND v_end;

                    ELSE
                        CONTINUE; -- skip custom metrics (manually entered)
                END CASE;

                -- Store result
                INSERT INTO kpi_actuals (
                    kpi_target_id, user_id, project_id,
                    period_start, period_end,
                    actual_value, target_value, notes
                )
                VALUES (
                    v_target.id, v_user.id, v_project.id,
                    v_start, v_end,
                    COALESCE(v_actual, 0), v_target.target_value,
                    'Auto-computed ' || p_period::TEXT || ' KPI'
                )
                ON CONFLICT (kpi_target_id, user_id, project_id, period_start)
                DO UPDATE SET
                    actual_value = EXCLUDED.actual_value,
                    computed_at  = NOW();

                v_computed := v_computed + 1;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN v_computed;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- BUDGET AUTO-POSTING TRIGGERS
-- =============================================================

-- 1. Post labour cost when a daily log entry is submitted
CREATE OR REPLACE FUNCTION fn_post_labour_budget()
RETURNS TRIGGER AS $$
DECLARE
    v_rate      NUMERIC(8,2);
    v_amount    NUMERIC(12,2);
    v_phase_id  INTEGER;
BEGIN
    -- Get hourly rate: entry rate → project rate → 0
    v_rate := COALESCE(
        NEW.hourly_rate,
        (SELECT hourly_rate FROM projects WHERE id = NEW.project_id),
        0
    );
    v_amount := NEW.hours_spent * v_rate;

    -- Find active phase for this project if any
    SELECT id INTO v_phase_id
    FROM project_phases
    WHERE project_id = NEW.project_id
      AND is_active = TRUE
      AND (start_date IS NULL OR start_date <= CURRENT_DATE)
      AND (end_date   IS NULL OR end_date   >= CURRENT_DATE)
    LIMIT 1;

    IF v_amount > 0 THEN
        INSERT INTO budget_entries (
            project_id, phase_id, entry_type,
            reference_id, reference_type,
            description, amount, entry_date
        )
        VALUES (
            NEW.project_id, v_phase_id, 'labour',
            NEW.id, 'daily_log_entry',
            'Labour: ' || (SELECT full_name FROM users u
                           JOIN daily_logs dl ON dl.user_id = u.id
                           WHERE dl.id = NEW.log_id) ||
            ' — ' || NEW.hours_spent || ' hrs',
            v_amount, (SELECT log_date FROM daily_logs WHERE id = NEW.log_id)
        );
    END IF;

    -- Check budget alert threshold
    PERFORM fn_check_budget_alert(NEW.project_id, v_phase_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_labour_budget
    AFTER INSERT ON daily_log_entries
    FOR EACH ROW EXECUTE FUNCTION fn_post_labour_budget();

-- 2. Post PO cost when an invoice is marked paid
CREATE OR REPLACE FUNCTION fn_post_po_budget()
RETURNS TRIGGER AS $$
DECLARE
    v_project_id INTEGER;
    v_phase_id   INTEGER;
BEGIN
    IF NEW.payment_status = 'paid' AND
       (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN

        SELECT po.project_id INTO v_project_id
        FROM purchase_orders po WHERE po.id = NEW.po_id;

        SELECT id INTO v_phase_id
        FROM project_phases
        WHERE project_id = v_project_id AND is_active = TRUE
          AND (start_date IS NULL OR start_date <= NEW.payment_date)
          AND (end_date   IS NULL OR end_date   >= NEW.payment_date)
        LIMIT 1;

        INSERT INTO budget_entries (
            project_id, phase_id, entry_type,
            reference_id, reference_type,
            description, amount, entry_date
        )
        VALUES (
            v_project_id, v_phase_id, 'purchase_order',
            NEW.id, 'invoice',
            'PO payment: Invoice ' || NEW.invoice_number,
            NEW.amount_invoiced,
            COALESCE(NEW.payment_date, CURRENT_DATE)
        );

        PERFORM fn_check_budget_alert(v_project_id, v_phase_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_po_budget
    AFTER INSERT OR UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION fn_post_po_budget();

-- 3. Post consumable cost when usage is logged
CREATE OR REPLACE FUNCTION fn_post_consumable_budget()
RETURNS TRIGGER AS $$
DECLARE
    v_unit_cost  NUMERIC(10,2);
    v_amount     NUMERIC(12,2);
    v_phase_id   INTEGER;
    v_project_id INTEGER;
BEGIN
    SELECT project_id INTO v_project_id
    FROM daily_log_entries WHERE id = NEW.log_entry_id;

    SELECT unit_cost INTO v_unit_cost FROM consumables WHERE id = NEW.consumable_id;
    v_amount := NEW.quantity_used * COALESCE(v_unit_cost, 0);

    SELECT id INTO v_phase_id
    FROM project_phases
    WHERE project_id = v_project_id AND is_active = TRUE
      AND (start_date IS NULL OR start_date <= CURRENT_DATE)
      AND (end_date   IS NULL OR end_date   >= CURRENT_DATE)
    LIMIT 1;

    IF v_amount > 0 THEN
        INSERT INTO budget_entries (
            project_id, phase_id, entry_type,
            reference_id, reference_type,
            description, amount, entry_date
        )
        VALUES (
            v_project_id, v_phase_id, 'consumable',
            NEW.id, 'consumable_daily_usage_item',
            'Consumable: ' || (SELECT name FROM consumables WHERE id = NEW.consumable_id) ||
            ' × ' || NEW.quantity_used,
            v_amount, CURRENT_DATE
        );

        PERFORM fn_check_budget_alert(v_project_id, v_phase_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_consumable_budget
    AFTER INSERT ON consumable_daily_usage_items
    FOR EACH ROW EXECUTE FUNCTION fn_post_consumable_budget();

-- Budget alert checker — called by all three posting triggers
CREATE OR REPLACE FUNCTION fn_check_budget_alert(
    p_project_id INTEGER,
    p_phase_id   INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_allocated  NUMERIC(12,2);
    v_spent      NUMERIC(12,2);
    v_threshold  NUMERIC(5,2);
    v_pct        NUMERIC(5,2);
    v_name       VARCHAR(200);
BEGIN
    -- Use phase budget if phase specified, otherwise project budget
    IF p_phase_id IS NOT NULL THEN
        SELECT pp.budget_allocated, pp.budget_alert_threshold, pp.phase_name
        INTO v_allocated, v_threshold, v_name
        FROM project_phases pp WHERE pp.id = p_phase_id;

        SELECT COALESCE(SUM(amount), 0) INTO v_spent
        FROM budget_entries WHERE phase_id = p_phase_id;
    ELSE
        SELECT p.budget_allocated, p.budget_alert_threshold, p.name
        INTO v_allocated, v_threshold, v_name
        FROM projects p WHERE p.id = p_project_id;

        SELECT COALESCE(SUM(amount), 0) INTO v_spent
        FROM budget_entries WHERE project_id = p_project_id;
    END IF;

    IF v_allocated IS NULL OR v_allocated = 0 THEN RETURN; END IF;

    v_pct := ROUND((v_spent / v_allocated) * 100, 1);

    IF v_pct >= v_threshold THEN
        -- Notify ops manager (avoid duplicate notifications within same day)
        INSERT INTO notifications (
            recipient_id, notification_type, title, message,
            reference_id, reference_type
        )
        SELECT u.id,
               'budget_alert',
               v_name || ' — budget at ' || v_pct || '%',
               v_name || ' has consumed ' || v_pct || '% of its allocated budget ($' ||
               v_spent || ' of $' || v_allocated || ').',
               p_project_id, 'project'
        FROM users u
        WHERE u.role IN ('ops_manager', 'ceo') AND u.is_active = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM notifications n2
              WHERE n2.recipient_id = u.id
                AND n2.notification_type = 'budget_alert'
                AND n2.reference_id = p_project_id
                AND n2.created_at::DATE = CURRENT_DATE
          );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Missing log detection — called by a cron job each morning at 10:00am
-- Flags all active lab techs who have no submitted log for the previous working day
CREATE OR REPLACE FUNCTION fn_flag_missing_logs()
RETURNS INTEGER AS $$
DECLARE
    v_yesterday     DATE := CURRENT_DATE - INTERVAL '1 day';
    v_flagged       INTEGER := 0;
    v_user          RECORD;
BEGIN
    FOR v_user IN
        SELECT id, full_name FROM users
        WHERE role = 'lab_tech' AND is_active = TRUE
    LOOP
        -- Check if they submitted a log for yesterday
        IF NOT EXISTS (
            SELECT 1 FROM daily_logs
            WHERE user_id = v_user.id
              AND log_date = v_yesterday
              AND submitted_at IS NOT NULL
        ) THEN
            -- Insert missing flag (ignore if already flagged)
            INSERT INTO missing_log_flags (user_id, missing_date)
            VALUES (v_user.id, v_yesterday)
            ON CONFLICT (user_id, missing_date) DO NOTHING;

            -- Notify the tech
            INSERT INTO notifications (recipient_id, notification_type, title, message, reference_type)
            VALUES (
                v_user.id,
                'missing_log',
                'Daily log not submitted',
                'Your daily log for ' || v_yesterday || ' was not submitted. Please complete it as soon as possible.',
                'daily_log'
            );

            -- Notify the ops manager
            INSERT INTO notifications (recipient_id, notification_type, title, message, reference_type)
            SELECT id,
                   'missing_log',
                   v_user.full_name || ' — missing daily log',
                   v_user.full_name || ' has not submitted their daily log for ' || v_yesterday || '.',
                   'daily_log'
            FROM users WHERE role = 'ops_manager' AND is_active = TRUE;

            v_flagged := v_flagged + 1;
        END IF;
    END LOOP;

    RETURN v_flagged;
END;
$$ LANGUAGE plpgsql;

-- Consumables at or below reorder threshold
CREATE VIEW consumables_needing_restock AS
SELECT
    c.id,
    c.name,
    c.sku,
    c.current_stock,
    c.reorder_threshold,
    c.reorder_quantity,
    c.unit,
    c.location,
    s.name  AS preferred_supplier,
    s.id    AS preferred_supplier_id
FROM consumables c
LEFT JOIN suppliers s ON s.id = c.preferred_supplier_id
WHERE c.is_active = TRUE
  AND c.current_stock <= c.reorder_threshold;

-- PO summary with line item totals and supplier info
CREATE VIEW po_summary AS
SELECT
    po.id,
    po.po_number,
    po.status,
    po.priority,
    po.risk_level,
    po.placed_date,
    po.received_date,
    po.expected_delivery,
    proj.code           AS project_code,
    proj.name           AS project_name,
    COALESCE(s.name, po.supplier_name_free) AS supplier_name,
    s.code              AS supplier_code,
    u_req.full_name     AS requested_by,
    u_app.full_name     AS approved_by,
    u_rec.full_name     AS receiver,
    COUNT(li.id)        AS line_item_count,
    SUM(li.quantity_ordered * COALESCE(li.unit_cost_estimate, 0)) AS estimated_total,
    SUM(li.quantity_ordered * COALESCE(li.unit_cost_actual, li.unit_cost_estimate, 0)) AS actual_total
FROM purchase_orders po
JOIN projects proj           ON proj.id = po.project_id
LEFT JOIN suppliers s        ON s.id = po.supplier_id
LEFT JOIN users u_req        ON u_req.id = po.requested_by
LEFT JOIN users u_app        ON u_app.id = po.approved_by
LEFT JOIN users u_rec        ON u_rec.id = po.receiver_id
LEFT JOIN po_line_items li   ON li.po_id = po.id
GROUP BY po.id, proj.code, proj.name, s.name, s.code,
         u_req.full_name, u_app.full_name, u_rec.full_name;

-- Daily log summary — hours per user per day across all projects
CREATE VIEW daily_log_summary AS
SELECT
    dl.id           AS log_id,
    dl.log_date,
    dl.submitted_at,
    u.full_name     AS employee,
    u.id            AS user_id,
    COUNT(dle.id)   AS projects_worked,
    SUM(dle.hours_spent) AS total_hours,
    ARRAY_AGG(p.code ORDER BY p.code) AS project_codes
FROM daily_logs dl
JOIN users u                ON u.id  = dl.user_id
JOIN daily_log_entries dle  ON dle.log_id = dl.id
JOIN projects p             ON p.id  = dle.project_id
GROUP BY dl.id, dl.log_date, dl.submitted_at, u.full_name, u.id;

-- Budget summary per project (lifetime)
CREATE VIEW project_budget_summary AS
SELECT
    p.id                                AS project_id,
    p.code                              AS project_code,
    p.name                              AS project_name,
    p.budget_allocated,
    p.budget_alert_threshold,
    p.hourly_rate,
    COALESCE(SUM(CASE WHEN b.entry_type = 'labour'         THEN b.amount ELSE 0 END), 0) AS labour_cost,
    COALESCE(SUM(CASE WHEN b.entry_type = 'consumable'     THEN b.amount ELSE 0 END), 0) AS consumable_cost,
    COALESCE(SUM(CASE WHEN b.entry_type = 'purchase_order' THEN b.amount ELSE 0 END), 0) AS po_cost,
    COALESCE(SUM(b.amount), 0)          AS total_spent,
    p.budget_allocated - COALESCE(SUM(b.amount), 0) AS budget_remaining,
    CASE WHEN p.budget_allocated > 0
         THEN ROUND((COALESCE(SUM(b.amount), 0) / p.budget_allocated) * 100, 1)
         ELSE 0 END                     AS pct_spent,
    CASE WHEN p.budget_allocated > 0 AND
              ROUND((COALESCE(SUM(b.amount), 0) / p.budget_allocated) * 100, 1) >= p.budget_alert_threshold
         THEN TRUE ELSE FALSE END       AS alert_triggered
FROM projects p
LEFT JOIN budget_entries b ON b.project_id = p.id
GROUP BY p.id, p.code, p.name, p.budget_allocated, p.budget_alert_threshold, p.hourly_rate;

-- KPI summary view — ops manager dashboard
CREATE VIEW kpi_summary AS
SELECT
    kt.id               AS kpi_target_id,
    kt.metric_name,
    kt.metric_type,
    kt.period,
    kt.target_value,
    kt.unit,
    u.full_name         AS employee,
    p.code              AS project_code,
    ka.period_start,
    ka.period_end,
    ka.actual_value,
    ka.met_target,
    ROUND(ka.actual_value - kt.target_value, 1) AS variance,
    ka.computed_at
FROM kpi_targets kt
LEFT JOIN kpi_actuals ka  ON ka.kpi_target_id = kt.id
LEFT JOIN users u         ON u.id = COALESCE(ka.user_id, kt.user_id)
LEFT JOIN projects p      ON p.id = COALESCE(ka.project_id, kt.project_id)
WHERE kt.is_active = TRUE
ORDER BY ka.period_start DESC, kt.metric_type, u.full_name;

-- Budget summary per phase
CREATE VIEW phase_budget_summary AS
SELECT
    pp.id               AS phase_id,
    pp.phase_name,
    pp.phase_number,
    p.code              AS project_code,
    p.name              AS project_name,
    pp.budget_allocated,
    pp.budget_alert_threshold,
    COALESCE(SUM(CASE WHEN b.entry_type = 'labour'         THEN b.amount ELSE 0 END), 0) AS labour_cost,
    COALESCE(SUM(CASE WHEN b.entry_type = 'consumable'     THEN b.amount ELSE 0 END), 0) AS consumable_cost,
    COALESCE(SUM(CASE WHEN b.entry_type = 'purchase_order' THEN b.amount ELSE 0 END), 0) AS po_cost,
    COALESCE(SUM(b.amount), 0)          AS total_spent,
    pp.budget_allocated - COALESCE(SUM(b.amount), 0) AS budget_remaining,
    CASE WHEN pp.budget_allocated > 0
         THEN ROUND((COALESCE(SUM(b.amount), 0) / pp.budget_allocated) * 100, 1)
         ELSE 0 END                     AS pct_spent
FROM project_phases pp
JOIN projects p ON p.id = pp.project_id
LEFT JOIN budget_entries b ON b.phase_id = pp.id
GROUP BY pp.id, pp.phase_name, pp.phase_number, p.code, p.name,
         pp.budget_allocated, pp.budget_alert_threshold;

-- =============================================================
-- NOTE: User accounts are seeded in 02_cortisol_tasks.sql
-- Default password for all accounts: ChangeMe!
-- =============================================================

-- =============================================================
-- PROJECT TEMPLATES
-- =============================================================

CREATE TABLE project_templates (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_template_tasks (
    id              SERIAL PRIMARY KEY,
    template_id     INTEGER NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    task_group      VARCHAR(100),
    priority        VARCHAR(20) DEFAULT 'normal',
    estimated_days  INTEGER,         -- relative duration
    offset_days     INTEGER DEFAULT 0, -- days after project start
    sort_order      INTEGER DEFAULT 0
);

-- =============================================================
-- OVERHEAD BUDGET
-- =============================================================

CREATE TABLE overhead_expenses (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    amount          NUMERIC(12,2) NOT NULL,
    is_recurring    BOOLEAN NOT NULL DEFAULT FALSE,
    frequency       VARCHAR(20),     -- 'weekly' | 'monthly' | 'yearly' | NULL
    start_date      DATE,
    end_date        DATE,
    category        VARCHAR(100),    -- e.g. 'utilities', 'software', 'equipment', 'admin'
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_overhead_recurring ON overhead_expenses(is_recurring);

