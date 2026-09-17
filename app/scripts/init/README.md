# Database Init Scripts

These SQL files run automatically in filename order when the PostgreSQL
container starts for the first time (empty volume).

They will NOT re-run if the volume already contains data.

Order:
  01_schema.sql      — all tables, enums, indexes, triggers, views
  02_cortisol_tasks.sql — Cortisol Phase 1 project + tasks + users
  03_suppliers.sql   — all 60 suppliers + blank credential placeholders
  04_consumables.sql — categories, auto-reorder trigger, sample items
  05_budget.sql      — project phases + budget config for Cortisol P1
  06_kpi.sql         — default KPI targets

To re-run from scratch:
  docker compose down -v   (WARNING: destroys all data)
  docker compose up -d --build
