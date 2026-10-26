-- =============================================================
-- Add common small-quantity units for reagents/antibodies
-- =============================================================
-- consumable_unit only had gram/milliliter as its smallest mass/volume
-- units — too coarse for antibody and reagent dosing, which is routinely
-- in micrograms/milligrams and microliters. Adds milligram, microgram,
-- and microliter so a consumable (and PO line items ordering it) can be
-- set to the unit it's actually dosed/ordered in.
--
-- ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction
-- block together with its own use, but this file has no surrounding
-- BEGIN/COMMIT and each statement commits on its own, so it's safe to
-- just run as-is. Safe to re-run (IF NOT EXISTS).

ALTER TYPE consumable_unit ADD VALUE IF NOT EXISTS 'microliter';
ALTER TYPE consumable_unit ADD VALUE IF NOT EXISTS 'milligram';
ALTER TYPE consumable_unit ADD VALUE IF NOT EXISTS 'microgram';
