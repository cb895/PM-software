# Database Init Scripts

These SQL files run automatically in filename order when the PostgreSQL
container starts for the first time (empty volume).

They will NOT re-run if the volume already contains data.

Order (every .sql file in this directory runs, sorted by filename — this
list must be kept in sync with what's actually here):
  01_schema.sql        — all tables, enums, indexes, triggers, views
  01_schema_fixed.sql  — task_delay_proposals table (added after 01_schema.sql)
  02_cortisol_tasks.sql — Cortisol Phase 1 project + tasks + users
  03_suppliers.sql     — all 60 suppliers + blank credential placeholders
  04_consumables.sql   — categories, auto-reorder trigger, sample items
  05_budget.sql        — project phases + budget config for Cortisol P1
  06_kpi.sql           — default KPI targets
  07_hr.sql            — HR portal tables (leave, staff status, calendar)

To re-run from scratch:
  docker compose down -v   (WARNING: destroys all data)
  docker compose up -d --build

IMPORTANT — this directory does NOT include the v1.9 additions (project
templates, overhead expenses/POs, PO urgency column, fn_auto_reorder_pos)
or any other content from ../migrations/ or ../../sql_patches/. Those are
applied manually and are NOT optional: even on a brand-new deployment, you
must still run all of sql_patches/*.sql per DEPLOY_INSTRUCTIONS.md Step 3
after the containers first come up, or PO creation, overhead tracking,
project templates, and the auto-reorder cron job will fail with
"relation/column/function does not exist" errors.
