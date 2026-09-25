"""
routers/projects.py — Project management endpoints
Create/edit: ops_manager only
Read: all authenticated users
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel
from datetime import date
from core.database import get_db
from core.security import get_current_user, require_roles

router = APIRouter()

# ---- Schemas ----

class ProjectCreate(BaseModel):
    code:                   str
    name:                   str
    description:            Optional[str]  = None
    client:                 Optional[str]  = None
    start_date:             Optional[date] = None
    end_date:               Optional[date] = None
    budget_allocated:       float = 0
    budget_alert_threshold: float = 80.0
    hourly_rate:            float = 0
    is_active:              bool  = True

class ProjectUpdate(BaseModel):
    name:                   Optional[str]   = None
    description:            Optional[str]   = None
    client:                 Optional[str]   = None
    start_date:             Optional[date]  = None
    end_date:               Optional[date]  = None
    budget_allocated:       Optional[float] = None
    budget_alert_threshold: Optional[float] = None
    hourly_rate:            Optional[float] = None
    is_active:              Optional[bool]  = None

class PhaseCreate(BaseModel):
    phase_name:             str
    phase_number:           int
    budget_allocated:       float = 0
    hourly_rate:            Optional[float] = None
    budget_alert_threshold: float = 80.0
    start_date:             Optional[date]  = None
    end_date:               Optional[date]  = None

# ---- Endpoints ----

@router.get("")
async def list_projects(
    active: Optional[bool] = Query(None),
    db     = Depends(get_db),
    user   = Depends(get_current_user),
):
    where = "WHERE p.is_active = TRUE" if active else ""
    result = await db.execute(text(f"""
        SELECT
            p.id, p.code, p.name, p.description, p.client,
            p.start_date, p.end_date, p.is_active,
            p.budget_allocated, p.budget_alert_threshold, p.hourly_rate,
            p.created_at,
            u.full_name AS created_by_name,
            -- Budget summary
            COALESCE(SUM(be.amount), 0)                         AS total_spent,
            CASE WHEN p.budget_allocated > 0
                 THEN ROUND(COALESCE(SUM(be.amount),0) / p.budget_allocated * 100, 1)
                 ELSE 0 END                                     AS pct_spent,
            -- Task summary
            COUNT(DISTINCT t.id)                                AS total_tasks,
            COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'complete')    AS tasks_complete,
            COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'in_progress') AS tasks_in_progress,
            COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'blocked')     AS tasks_blocked,
            -- Phase count
            COUNT(DISTINCT pp.id)                               AS phase_count
        FROM projects p
        LEFT JOIN users u              ON u.id  = p.created_by
        LEFT JOIN budget_entries be    ON be.project_id = p.id
        LEFT JOIN tasks t              ON t.project_id  = p.id
        LEFT JOIN project_phases pp    ON pp.project_id = p.id
        {where}
        GROUP BY p.id, u.full_name
        ORDER BY p.is_active DESC, p.start_date DESC NULLS LAST
    """))
    return [dict(r) for r in result.mappings()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    # Check code is unique
    existing = await db.execute(text(
        "SELECT id FROM projects WHERE code = :code"
    ), {"code": body.code.upper()})
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"Project code '{body.code}' already exists.")

    result = await db.execute(text("""
        INSERT INTO projects
            (code, name, description, client, start_date, end_date,
             budget_allocated, budget_alert_threshold, hourly_rate,
             is_active, created_by)
        VALUES
            (:code, :name, :description, :client, :start_date, :end_date,
             :budget_allocated, :budget_alert_threshold, :hourly_rate,
             :is_active, :created_by)
        RETURNING id
    """), {
        "code":                   body.code.upper(),
        "name":                   body.name,
        "description":            body.description,
        "client":                 body.client,
        "start_date":             body.start_date,
        "end_date":               body.end_date,
        "budget_allocated":       body.budget_allocated,
        "budget_alert_threshold": body.budget_alert_threshold,
        "hourly_rate":            body.hourly_rate,
        "is_active":              body.is_active,
        "created_by":             user.id,
    })
    project_id = result.scalar_one()

    # Seed leave balances and KPI targets for new project if needed
    # (KPI targets with project_id=NULL already cover all projects automatically)

    await db.commit()
    return {"id": project_id, "message": f"Project {body.code.upper()} created."}


@router.get("/{project_id}")
async def get_project(
    project_id: int,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT p.*, u.full_name AS created_by_name
        FROM projects p
        LEFT JOIN users u ON u.id = p.created_by
        WHERE p.id = :id
    """), {"id": project_id})
    row = result.mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Project not found.")

    # Phases
    phases = await db.execute(text("""
        SELECT * FROM project_phases WHERE project_id = :id ORDER BY phase_number
    """), {"id": project_id})

    return {**dict(row), "phases": [dict(r) for r in phases.mappings()]}


@router.patch("/{project_id}")
async def update_project(
    project_id: int,
    body: ProjectUpdate,
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update.")
    set_clause = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = project_id
    await db.execute(text(
        f"UPDATE projects SET {set_clause}, updated_at = NOW() WHERE id = :id"
    ), data)
    await db.commit()
    return {"message": "Project updated."}


@router.post("/{project_id}/phases", status_code=status.HTTP_201_CREATED)
async def create_phase(
    project_id: int,
    body: PhaseCreate,
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    result = await db.execute(text("""
        INSERT INTO project_phases
            (project_id, phase_name, phase_number, budget_allocated,
             hourly_rate, budget_alert_threshold, start_date, end_date, is_active)
        VALUES
            (:project_id, :phase_name, :phase_number, :budget_allocated,
             :hourly_rate, :budget_alert_threshold, :start_date, :end_date, TRUE)
        RETURNING id
    """), {
        "project_id":             project_id,
        "phase_name":             body.phase_name,
        "phase_number":           body.phase_number,
        "budget_allocated":       body.budget_allocated,
        "hourly_rate":            body.hourly_rate,
        "budget_alert_threshold": body.budget_alert_threshold,
        "start_date":             body.start_date,
        "end_date":               body.end_date,
    })
    phase_id = result.scalar_one()
    await db.commit()
    return {"id": phase_id, "message": "Phase created."}


@router.post("/{project_id}/deactivate")
async def deactivate_project(
    project_id: int,
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    """
    Soft deactivate — hides project from active dropdowns.
    All tasks, logs, POs, and budget entries are fully preserved.
    Can be reactivated at any time.
    """
    result = await db.execute(text(
        "SELECT name, is_active FROM projects WHERE id = :id"
    ), {"id": project_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Project not found.")
    if not row[1]:
        raise HTTPException(400, f"'{row[0]}' is already inactive.")

    await db.execute(text(
        "UPDATE projects SET is_active = FALSE, updated_at = NOW() WHERE id = :id"
    ), {"id": project_id})
    await db.commit()
    return {"message": f"'{row[0]}' deactivated. All data preserved."}


@router.post("/{project_id}/reactivate")
async def reactivate_project(
    project_id: int,
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    """Reactivate a previously deactivated project."""
    result = await db.execute(text(
        "SELECT name FROM projects WHERE id = :id"
    ), {"id": project_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Project not found.")

    await db.execute(text(
        "UPDATE projects SET is_active = TRUE, updated_at = NOW() WHERE id = :id"
    ), {"id": project_id})
    await db.commit()
    return {"message": f"'{row[0]}' reactivated."}


@router.delete("/{project_id}")
async def delete_project(
    project_id: int,
    confirm:    str = None,   # must pass ?confirm=DELETE to prevent accidents
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    """
    HARD DELETE — ops manager only.
    Permanently removes the project and ALL associated data:
    tasks, daily log entries, budget entries, KPI actuals, PO links, phase
    records, and project-specific consumables (and their transaction history).
    This cannot be undone.
    Requires ?confirm=DELETE query parameter as a safety check.
    """
    if confirm != "DELETE":
        raise HTTPException(
            400,
            "Hard delete requires ?confirm=DELETE in the request. "
            "This action is permanent and cannot be undone."
        )

    result = await db.execute(text(
        "SELECT name FROM projects WHERE id = :id"
    ), {"id": project_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Project not found.")

    project_name = row[0]

    # Delete in dependency order
    # Budget entries
    await db.execute(text(
        "DELETE FROM budget_entries WHERE project_id = :id"
    ), {"id": project_id})
    # KPI actuals linked to this project
    await db.execute(text(
        "DELETE FROM kpi_actuals WHERE project_id = :id"
    ), {"id": project_id})
    # KPI targets scoped to this project
    await db.execute(text(
        "DELETE FROM kpi_targets WHERE project_id = :id"
    ), {"id": project_id})
    # Task delay proposals
    await db.execute(text("""
        DELETE FROM task_delay_proposals
        WHERE task_id IN (SELECT id FROM tasks WHERE project_id = :id)
    """), {"id": project_id})
    # Task history
    await db.execute(text("""
        DELETE FROM task_history
        WHERE task_id IN (SELECT id FROM tasks WHERE project_id = :id)
    """), {"id": project_id})
    # Task assignments
    await db.execute(text("""
        DELETE FROM task_assignees
        WHERE task_id IN (SELECT id FROM tasks WHERE project_id = :id)
    """), {"id": project_id})
    # Tasks
    await db.execute(text(
        "DELETE FROM tasks WHERE project_id = :id"
    ), {"id": project_id})
    # Daily log entry tasks + consumable usage (entries reference projects)
    await db.execute(text("""
        DELETE FROM daily_log_entry_tasks
        WHERE log_entry_id IN (
            SELECT id FROM daily_log_entries WHERE project_id = :id
        )
    """), {"id": project_id})
    await db.execute(text("""
        DELETE FROM consumable_daily_usage_items
        WHERE usage_id IN (
            SELECT cdu.id FROM consumable_daily_usage cdu
            JOIN daily_log_entries dle ON dle.id = cdu.log_entry_id
            WHERE dle.project_id = :id
        )
    """), {"id": project_id})
    await db.execute(text("""
        DELETE FROM consumable_daily_usage
        WHERE log_entry_id IN (
            SELECT id FROM daily_log_entries WHERE project_id = :id
        )
    """), {"id": project_id})
    await db.execute(text(
        "DELETE FROM daily_log_entries WHERE project_id = :id"
    ), {"id": project_id})
    # PO line items for POs linked to this project
    await db.execute(text("""
        DELETE FROM po_line_items
        WHERE po_id IN (SELECT id FROM purchase_orders WHERE project_id = :id)
    """), {"id": project_id})
    # POs
    await db.execute(text(
        "DELETE FROM purchase_orders WHERE project_id = :id"
    ), {"id": project_id})
    # Weekly report sections
    await db.execute(text(
        "DELETE FROM weekly_report_sections WHERE project_id = :id"
    ), {"id": project_id})
    # Consumable transactions — both ones logged against this project (any
    # consumable) and any transaction referencing a consumable that's about
    # to be deleted below (a shared item used here could have transactions
    # tagged with a different project_id, so consumable_id must be checked too)
    await db.execute(text("""
        DELETE FROM consumable_transactions
        WHERE project_id = :id
           OR consumable_id IN (SELECT id FROM consumables WHERE project_id = :id)
    """), {"id": project_id})
    # Project-specific consumables (NULL project_id = shared, untouched)
    await db.execute(text(
        "DELETE FROM consumables WHERE project_id = :id"
    ), {"id": project_id})
    # Project phases
    await db.execute(text(
        "DELETE FROM project_phases WHERE project_id = :id"
    ), {"id": project_id})
    # Finally the project itself
    await db.execute(text(
        "DELETE FROM projects WHERE id = :id"
    ), {"id": project_id})

    await db.commit()
    return {
        "message": f"Project '{project_name}' and all associated data permanently deleted."
    }
