-- =============================================================
-- Support sub-tasks in project templates
-- =============================================================
-- project_template_tasks had no parent/child concept at all — templates
-- were always flat, even though real project tasks support one level of
-- sub-tasks (tasks.parent_task_id). This is needed to generate a
-- template from an existing project's task list and have it carry the
-- same task/sub-task structure.
--
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE project_template_tasks
    ADD COLUMN IF NOT EXISTS parent_template_task_id INTEGER REFERENCES project_template_tasks(id);
