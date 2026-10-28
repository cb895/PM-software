-- =============================================================
-- Per-line-item PO budget treatment
--
-- Lets each PO line item be marked for how it affects the budget once
-- it's received:
--   overhead          -> posts to the overhead budget_entries (no project)
--   project_cost      -> posts to the PO's project budget_entries
--   consumable_usage  -> no posting here; cost is tracked separately as
--                        the stock is actually consumed (daily log usage)
--
-- Example: a PO for coffee (overhead) + antibodies (consumable_usage) +
-- a one-off reagent charged straight to the project (project_cost).
--
-- Usage:
--   docker cp 14_po_line_item_budget_treatment.sql labpm_db:/14_po_line_item_budget_treatment.sql
--   docker compose exec db psql -U labpm_user labpm -f /14_po_line_item_budget_treatment.sql
-- =============================================================

\echo 'Adding po_line_items.budget_treatment...'

ALTER TABLE po_line_items
    ADD COLUMN IF NOT EXISTS budget_treatment VARCHAR(20) NOT NULL DEFAULT 'project_cost';

ALTER TABLE po_line_items DROP CONSTRAINT IF EXISTS po_line_items_budget_treatment_check;
ALTER TABLE po_line_items
    ADD CONSTRAINT po_line_items_budget_treatment_check
    CHECK (budget_treatment IN ('overhead', 'project_cost', 'consumable_usage'));

-- Backfill existing rows with a sensible default based on what's already known:

-- Items linked to a tracked consumable are consumed from stock over time —
-- their cost already shows up via consumable usage, not at receipt.
UPDATE po_line_items
SET budget_treatment = 'consumable_usage'
WHERE consumable_id IS NOT NULL;

-- Items on a whole-PO overhead purchase default to overhead.
UPDATE po_line_items li
SET budget_treatment = 'overhead'
FROM purchase_orders po
WHERE po.id = li.po_id AND po.is_overhead = TRUE AND li.consumable_id IS NULL;

\echo 'po_line_items.budget_treatment added.'
SELECT budget_treatment, COUNT(*) FROM po_line_items GROUP BY budget_treatment;
