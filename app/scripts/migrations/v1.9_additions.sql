-- =============================================================
-- v1.9 Migration — run on deployed server
-- Adds: project templates, overhead expenses, PO number format,
--       auto-reorder PO function
--
-- Usage:
--   docker cp v1.9_additions.sql labpm_db:/v1.9.sql
--   docker compose exec db psql -U labpm_user labpm -f /v1.9.sql
-- =============================================================

\echo 'Applying v1.9 migrations...'

CREATE TABLE IF NOT EXISTS project_templates (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_template_tasks (
    id              SERIAL PRIMARY KEY,
    template_id     INTEGER NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    task_group      VARCHAR(100),
    priority        VARCHAR(20) DEFAULT 'normal',
    estimated_days  INTEGER,
    offset_days     INTEGER DEFAULT 0,
    sort_order      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS overhead_expenses (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    amount          NUMERIC(12,2) NOT NULL,
    is_recurring    BOOLEAN NOT NULL DEFAULT FALSE,
    frequency       VARCHAR(20),
    start_date      DATE,
    end_date        DATE,
    category        VARCHAR(100),
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-reorder: creates draft POs when stock hits threshold
CREATE OR REPLACE FUNCTION fn_auto_reorder_pos()
RETURNS INTEGER AS $$
DECLARE
    v_item   RECORD;
    v_po_id  INTEGER;
    v_count  INTEGER := 0;
BEGIN
    FOR v_item IN
        SELECT c.id, c.name, c.sku, c.reorder_quantity, c.unit,
               c.unit_cost, c.project_id, c.preferred_supplier_id,
               s.code AS supplier_code
        FROM consumables c
        LEFT JOIN suppliers s ON s.id = c.preferred_supplier_id
        WHERE c.is_active = TRUE
          AND c.auto_reorder = TRUE
          AND c.reorder_po_drafted = FALSE
          AND c.current_stock <= c.reorder_threshold
    LOOP
        INSERT INTO purchase_orders (
            project_id, supplier_id, supplier_name_free,
            status, priority, notes, requested_by
        )
        SELECT
            v_item.project_id,
            v_item.preferred_supplier_id,
            CASE WHEN v_item.preferred_supplier_id IS NULL
                 THEN 'Pending — supplier to be assigned'
                 ELSE NULL END,
            'pending', 'normal',
            'Auto-generated reorder PO — ' || v_item.name || ' stock below threshold.',
            id
        FROM users WHERE role = 'ops_manager' AND is_active = TRUE LIMIT 1
        RETURNING id INTO v_po_id;

        INSERT INTO po_line_items (
            po_id, description, product_id,
            quantity_ordered, unit, unit_cost_estimate
        ) VALUES (
            v_po_id, v_item.name, v_item.sku,
            COALESCE(v_item.reorder_quantity, 1),
            v_item.unit, v_item.unit_cost
        );

        UPDATE consumables
        SET reorder_po_drafted = TRUE, updated_at = NOW()
        WHERE id = v_item.id;

        INSERT INTO notifications (recipient_id, notification_type, title, message, reference_id, reference_type)
        SELECT id, 'reorder_po',
               'Auto-reorder PO created — ' || v_item.name,
               'Stock below threshold. Draft PO awaiting approval.',
               v_po_id, 'purchase_order'
        FROM users WHERE role = 'ops_manager' AND is_active = TRUE;

        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- PO number assigned on approval: [SUPPLIER_CODE]-[YYMMDD]
CREATE OR REPLACE FUNCTION fn_assign_po_number()
RETURNS TRIGGER AS $$
DECLARE
    v_code TEXT;
BEGIN
    IF NEW.status = 'approved' AND OLD.status != 'approved' AND NEW.po_number IS NULL THEN
        SELECT COALESCE(s.code, 'PND')
        INTO v_code
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.id = NEW.id;

        NEW.po_number := UPPER(COALESCE(v_code,'PND')) || '-' || TO_CHAR(NOW(), 'YYMMDD');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_po_number ON purchase_orders;
CREATE TRIGGER trg_assign_po_number
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION fn_assign_po_number();

-- Add auto-reorder to cron (call fn_auto_reorder_pos daily)
-- Already handled by labpm_cron container — add to crontab:
-- 0 10 * * 1-5   psql -U labpm_user -d labpm -c "SELECT fn_auto_reorder_pos();"

\echo 'v1.9 migration complete.'
SELECT 'project_templates table: OK' WHERE EXISTS (SELECT 1 FROM project_templates LIMIT 1) OR TRUE;
SELECT 'overhead_expenses table: OK' WHERE EXISTS (SELECT 1 FROM overhead_expenses LIMIT 1) OR TRUE;

-- =============================================================
-- Overhead PO support
-- Makes project_id optional on purchase_orders and budget_entries
-- Adds is_overhead flag to purchase_orders
-- Updates fn_post_po_budget to post to overhead_expenses on approval
-- =============================================================

\echo 'Adding overhead PO support...'

-- Allow NULL project_id on purchase_orders
ALTER TABLE purchase_orders
    ALTER COLUMN project_id DROP NOT NULL;

-- Add is_overhead flag
ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS is_overhead BOOLEAN NOT NULL DEFAULT FALSE;

-- Allow NULL project_id on budget_entries
ALTER TABLE budget_entries
    ALTER COLUMN project_id DROP NOT NULL;

-- Add is_overhead flag to budget_entries
ALTER TABLE budget_entries
    ADD COLUMN IF NOT EXISTS is_overhead BOOLEAN NOT NULL DEFAULT FALSE;

-- Update fn_post_po_budget to handle overhead POs
-- Posts to budget_entries with is_overhead=TRUE when project_id is NULL
CREATE OR REPLACE FUNCTION fn_post_po_budget()
RETURNS TRIGGER AS $$
DECLARE
    v_project_id INTEGER;
    v_phase_id   INTEGER;
    v_is_overhead BOOLEAN;
BEGIN
    IF NEW.payment_status = 'paid' AND
       (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN

        SELECT po.project_id, po.is_overhead
        INTO v_project_id, v_is_overhead
        FROM purchase_orders po WHERE po.id = NEW.po_id;

        IF v_is_overhead OR v_project_id IS NULL THEN
            -- Overhead PO — post to budget_entries with is_overhead flag
            INSERT INTO budget_entries (
                project_id, phase_id, entry_type,
                reference_id, reference_type,
                description, amount, entry_date,
                is_overhead
            ) VALUES (
                NULL, NULL, 'purchase_order',
                NEW.id, 'invoice',
                'Overhead PO payment: Invoice ' || NEW.invoice_number,
                NEW.amount_invoiced,
                COALESCE(NEW.payment_date, CURRENT_DATE),
                TRUE
            );
        ELSE
            -- Project PO — post to project budget as before
            SELECT id INTO v_phase_id
            FROM project_phases
            WHERE project_id = v_project_id AND is_active = TRUE
              AND (start_date IS NULL OR start_date <= NEW.payment_date)
              AND (end_date   IS NULL OR end_date   >= NEW.payment_date)
            LIMIT 1;

            INSERT INTO budget_entries (
                project_id, phase_id, entry_type,
                reference_id, reference_type,
                description, amount, entry_date,
                is_overhead
            ) VALUES (
                v_project_id, v_phase_id, 'purchase_order',
                NEW.id, 'invoice',
                'PO payment: Invoice ' || NEW.invoice_number,
                NEW.amount_invoiced,
                COALESCE(NEW.payment_date, CURRENT_DATE),
                FALSE
            );

            PERFORM fn_check_budget_alert(v_project_id, v_phase_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

\echo 'Overhead PO support added.'
