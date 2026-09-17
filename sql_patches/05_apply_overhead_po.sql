-- =============================================================
-- Overhead PO Migration — run on deployed server
-- Allows POs to be marked as overhead (no project required)
-- Overhead PO payments post to overhead budget entries
--
-- Usage:
--   docker cp apply_overhead_po.sql labpm_db:/apply_overhead_po.sql
--   docker compose exec db psql -U labpm_user labpm -f /apply_overhead_po.sql
-- =============================================================

\echo 'Applying overhead PO support...'

-- Allow NULL project_id on purchase_orders
ALTER TABLE purchase_orders
    ALTER COLUMN project_id DROP NOT NULL;

-- Add is_overhead flag to purchase_orders
ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS is_overhead BOOLEAN NOT NULL DEFAULT FALSE;

-- Allow NULL project_id on budget_entries
ALTER TABLE budget_entries
    ALTER COLUMN project_id DROP NOT NULL;

-- Add is_overhead flag to budget_entries
ALTER TABLE budget_entries
    ADD COLUMN IF NOT EXISTS is_overhead BOOLEAN NOT NULL DEFAULT FALSE;

-- Update fn_post_po_budget to handle overhead POs
CREATE OR REPLACE FUNCTION fn_post_po_budget()
RETURNS TRIGGER AS $$
DECLARE
    v_project_id  INTEGER;
    v_phase_id    INTEGER;
    v_is_overhead BOOLEAN;
BEGIN
    IF NEW.payment_status = 'paid' AND
       (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN

        SELECT po.project_id, po.is_overhead
        INTO v_project_id, v_is_overhead
        FROM purchase_orders po WHERE po.id = NEW.po_id;

        IF v_is_overhead OR v_project_id IS NULL THEN
            -- Overhead PO — post with is_overhead flag, no project
            INSERT INTO budget_entries (
                project_id, phase_id, entry_type,
                reference_id, reference_type,
                description, amount, entry_date, is_overhead
            ) VALUES (
                NULL, NULL, 'purchase_order',
                NEW.id, 'invoice',
                'Overhead PO payment: Invoice ' || COALESCE(NEW.invoice_number, NEW.id::TEXT),
                NEW.amount_invoiced,
                COALESCE(NEW.payment_date, CURRENT_DATE),
                TRUE
            );
        ELSE
            -- Project PO — post to project budget as before
            SELECT id INTO v_phase_id
            FROM project_phases
            WHERE project_id = v_project_id AND is_active = TRUE
              AND (start_date IS NULL OR start_date <= COALESCE(NEW.payment_date, CURRENT_DATE))
              AND (end_date   IS NULL OR end_date   >= COALESCE(NEW.payment_date, CURRENT_DATE))
            LIMIT 1;

            INSERT INTO budget_entries (
                project_id, phase_id, entry_type,
                reference_id, reference_type,
                description, amount, entry_date, is_overhead
            ) VALUES (
                v_project_id, v_phase_id, 'purchase_order',
                NEW.id, 'invoice',
                'PO payment: Invoice ' || COALESCE(NEW.invoice_number, NEW.id::TEXT),
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

\echo 'Overhead PO support applied.'
SELECT 'purchase_orders.is_overhead column: ' || data_type
FROM information_schema.columns
WHERE table_name = 'purchase_orders' AND column_name = 'is_overhead';
SELECT 'budget_entries.is_overhead column: ' || data_type
FROM information_schema.columns
WHERE table_name = 'budget_entries' AND column_name = 'is_overhead';
