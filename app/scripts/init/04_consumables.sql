-- =============================================================
-- Consumables Module — Auto-reorder trigger + category seed
-- Run after schema.sql
-- =============================================================

-- =============================================================
-- AUTO-REORDER TRIGGER
-- Fires after any update to consumables.current_stock.
-- If stock drops to or below reorder_threshold AND auto_reorder
-- is TRUE AND a draft PO hasn't already been created, it:
--   1. Inserts a new purchase_order in 'pending' status
--   2. Adds a line item for the reorder_quantity
--   3. Sets reorder_po_drafted = TRUE to prevent duplicates
-- The ops manager sees the draft PO in their approval queue.
-- =============================================================

CREATE OR REPLACE FUNCTION fn_auto_reorder_po()
RETURNS TRIGGER AS $$
DECLARE
    v_po_id     INTEGER;
    v_project   INTEGER;
    v_requester INTEGER;
BEGIN
    -- Only fire when stock has dropped to or below threshold
    IF NEW.current_stock <= NEW.reorder_threshold
       AND NEW.auto_reorder = TRUE
       AND NEW.reorder_po_drafted = FALSE
    THEN
        -- Use the consumable's project, fall back to first active project
        v_project := COALESCE(
            NEW.project_id,
            (SELECT id FROM projects WHERE is_active = TRUE ORDER BY id LIMIT 1)
        );

        -- Use the ops manager as default requester for auto-generated POs
        SELECT id INTO v_requester
        FROM users
        WHERE role = 'ops_manager' AND is_active = TRUE
        LIMIT 1;

        -- Create draft PO
        INSERT INTO purchase_orders (
            project_id,
            supplier_id,
            requested_by,
            status,
            priority,
            notes
        )
        VALUES (
            v_project,
            NEW.preferred_supplier_id,
            v_requester,
            'pending',
            'normal',
            'Auto-generated reorder: ' || NEW.name || ' stock at ' ||
            NEW.current_stock || ' ' || NEW.unit::TEXT ||
            ' (threshold: ' || NEW.reorder_threshold || ')'
        )
        RETURNING id INTO v_po_id;

        -- Add line item
        INSERT INTO po_line_items (
            po_id,
            description,
            quantity_ordered,
            unit,
            unit_cost_estimate,
            consumable_id
        )
        VALUES (
            v_po_id,
            NEW.name,
            COALESCE(NEW.reorder_quantity, NEW.reorder_threshold),
            NEW.unit,
            NEW.unit_cost,
            NEW.id
        );

        -- Mark as drafted to prevent duplicates
        NEW.reorder_po_drafted := TRUE;
    END IF;

    -- Reset the flag when stock is replenished above threshold
    IF NEW.current_stock > NEW.reorder_threshold THEN
        NEW.reorder_po_drafted := FALSE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consumable_auto_reorder
    BEFORE UPDATE OF current_stock ON consumables
    FOR EACH ROW EXECUTE FUNCTION fn_auto_reorder_po();

-- =============================================================
-- CONSUMABLE CATEGORIES reference (for UI dropdowns)
-- =============================================================

-- Category descriptions view for frontend dropdowns
CREATE VIEW consumable_category_list AS
SELECT category,
       CASE category
           WHEN 'reagent'     THEN 'Reagents — assay chemicals and solutions'
           WHEN 'antibody'    THEN 'Antibodies — detection and capture antibodies'
           WHEN 'buffer'      THEN 'Buffers — running buffers and diluents'
           WHEN 'antigen'     THEN 'Antigens — calibrators and controls'
           WHEN 'conjugate'   THEN 'Conjugate — labeled antibody conjugates'
           WHEN 'nanoparticle'THEN 'Nanoparticles — colloidal gold and latex beads'
           WHEN 'membrane'    THEN 'Membranes — nitrocellulose and backing cards'
           WHEN 'packaging'   THEN 'Packaging — pouches, desiccants, labels'
           WHEN 'equipment'   THEN 'Equipment — hardware and instruments'
           WHEN 'general'     THEN 'General — office and general lab supplies'
       END AS description
FROM unnest(enum_range(NULL::consumable_category)) AS category;

-- =============================================================
-- SAMPLE CONSUMABLES
-- Placeholder items to demonstrate the structure —
-- replace/extend with your actual inventory via the UI
-- or by adding rows below following the same pattern
-- =============================================================

INSERT INTO consumables (
    name, category, project_id, is_shared,
    sku, unit, current_stock, reorder_threshold,
    reorder_quantity, unit_cost, preferred_supplier_id,
    location, auto_reorder, is_active
)
SELECT
    name, category::consumable_category,
    (SELECT id FROM projects WHERE code = 'CORT-P1'),
    is_shared, sku, unit::consumable_unit,
    current_stock, reorder_threshold,
    reorder_quantity, unit_cost,
    (SELECT id FROM suppliers WHERE code = supplier_code LIMIT 1),
    location, TRUE, TRUE
FROM (VALUES
    -- Shared reagents (available to all projects)
    ('PBS Buffer 1x',           'buffer',      TRUE,  'PBS-1X-500',  'liter',  10, 3, 5,  12.50, 'FIS', 'Reagent shelf A1'),
    ('Blocking Buffer 5%',      'buffer',      TRUE,  'BB-5PCT',     'liter',  5,  2, 4,  28.00, 'SGA', 'Reagent shelf A2'),
    ('Wash Buffer',             'buffer',      TRUE,  'WB-001',      'liter',  8,  2, 5,  15.00, 'FIS', 'Reagent shelf A3'),

    -- Cortisol P1 specific — antibodies
    ('Anti-Cortisol Ab (Capture)',  'antibody', FALSE, 'AC-CAP-001', 'milliliter', 2,  1, 3, 245.00, 'ARB', 'Freezer -20C Box 1'),
    ('Anti-Cortisol Ab (Detection)','antibody', FALSE, 'AC-DET-001', 'milliliter', 2,  1, 3, 265.00, 'ARB', 'Freezer -20C Box 1'),
    ('Goat Anti-Mouse IgG',     'antibody',    TRUE,  'GAM-001',     'milliliter', 3,  1, 3, 195.00, 'JIR', 'Freezer -20C Box 2'),

    -- Cortisol P1 specific — antigens
    ('Cortisol Antigen',        'antigen',     FALSE, 'CORT-AG-001', 'milliliter', 1,  1, 2, 312.00, 'MXB', 'Freezer -80C'),
    ('BSA Blocking Protein',    'antigen',     TRUE,  'BSA-001',     'gram',       50, 10, 25, 8.50, 'SGA', 'Reagent shelf B1'),

    -- Conjugates
    ('Gold Nanoparticle 40nm',  'nanoparticle',FALSE, 'GNP-40NM',   'milliliter', 5,  2, 5, 185.00, 'BBI', 'Reagent shelf B2'),
    ('Colloidal Gold Conjugate','conjugate',   FALSE, 'CGC-001',     'milliliter', 3,  1, 3, 220.00, 'BBI', 'Reagent shelf B3'),

    -- Membranes
    ('Nitrocellulose Membrane', 'membrane',    FALSE, 'NC-M-001',    'each',       20, 5, 10, 45.00, 'SRT', 'Dry storage cabinet'),
    ('Backing Card',            'membrane',    FALSE, 'BC-001',      'each',       100,20, 50,  2.50, 'SRT', 'Dry storage cabinet'),

    -- General shared
    ('Microcentrifuge Tubes 1.5ml','general',  TRUE,  'MCT-1.5',     'pack',       8,  2, 5,  18.00, 'FIS', 'Consumables drawer 1'),
    ('Pipette Tips 200ul',      'general',     TRUE,  'PT-200',      'pack',       6,  2, 4,  22.00, 'FIS', 'Consumables drawer 1'),
    ('Nitrile Gloves M',        'general',     TRUE,  'GLV-M',       'box',        4,  1, 3,  12.00, 'FIS', 'PPE cabinet')
) AS t(name, category, is_shared, sku, unit, current_stock, reorder_threshold, reorder_quantity, unit_cost, supplier_code, location);

-- =============================================================
-- VERIFICATION
-- =============================================================
SELECT category, COUNT(*) AS items, SUM(current_stock) AS total_stock_units
FROM consumables
GROUP BY category
ORDER BY category;

SELECT name, current_stock, reorder_threshold,
       CASE WHEN current_stock <= reorder_threshold THEN 'REORDER NOW' ELSE 'OK' END AS stock_status
FROM consumables
ORDER BY stock_status DESC, name;
