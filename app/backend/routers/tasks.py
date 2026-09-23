"""routers/tasks.py — Task tracker endpoints"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional, List
from pydantic import BaseModel
from datetime import date
from core.database import get_db
from core.security import get_current_user, require_task_editor

router = APIRouter()

# ---- Schemas ----

class TaskCreate(BaseModel):
    project_id:     int
    title:          str
    description:    Optional[str]  = None
    task_group:     Optional[str]  = None
    status:         str = 'not_started'
    priority:       str = 'normal'
    planned_start:  Optional[date] = None
    planned_end:    Optional[date] = None
    is_milestone:   bool = False
    parent_task_id: Optional[int]  = None
    assignee_ids:   List[int] = []

class TaskUpdate(BaseModel):
    title:         Optional[str]  = None
    description:   Optional[str]  = None
    status:        Optional[str]  = None
    priority:      Optional[str]  = None
    planned_start: Optional[date] = None
    planned_end:   Optional[date] = None
    actual_start:  Optional[date] = None
    actual_end:    Optional[date] = None
    is_milestone:  Optional[bool] = None

class StatusUpdate(BaseModel):
    status: str

# ---- Endpoints ----

@router.get("")
async def list_tasks(
    project_id: Optional[int] = Query(None),
    status:     Optional[str] = Query(None),
    task_group: Optional[str] = Query(None),
    db  = Depends(get_db),
    user = Depends(get_current_user),
):
    params = {}
    where = []
    if project_id:
        where.append("t.project_id = :project_id")
        params["project_id"] = project_id
    if status:
        where.append("t.status = :status")
        params["status"] = status
    if task_group:
        where.append("t.task_group = :task_group")
        params["task_group"] = task_group
    if False:  # placeholder
        where.append("t.status = :status")
        params["status"] = status
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    result = await db.execute(text(f"""
        SELECT
            t.id, t.title, t.task_group, t.description,
            t.status, t.priority, t.is_milestone, t.parent_task_id,
            t.planned_start, t.planned_end, t.actual_start, t.actual_end,
            t.created_at, t.updated_at,
            p.code  AS project_code,
            p.name  AS project_name,
            ARRAY_AGG(u.full_name ORDER BY u.full_name)
                FILTER (WHERE u.id IS NOT NULL) AS assignees,
            ARRAY_AGG(u.id ORDER BY u.full_name)
                FILTER (WHERE u.id IS NOT NULL) AS assignee_ids
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN task_assignees ta ON ta.task_id = t.id
        LEFT JOIN users u           ON u.id = ta.user_id
        {where_sql}
        GROUP BY t.id, p.code, p.name
        ORDER BY t.planned_start NULLS LAST, t.id
    """), params)
    return [dict(r) for r in result.mappings()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    result = await db.execute(text("""
        INSERT INTO tasks
            (project_id, created_by, title, description, task_group,
             status, priority, planned_start, planned_end, is_milestone, parent_task_id)
        VALUES
            (:project_id, :created_by, :title, :description, :task_group,
             :status, :priority, :planned_start, :planned_end, :is_milestone, :parent_task_id)
        RETURNING id
    """), {
        "project_id":     body.project_id,
        "created_by":     user.id,
        "title":          body.title,
        "description":    body.description,
        "task_group":     body.task_group,
        "status":         body.status,
        "priority":       body.priority,
        "planned_start":  body.planned_start,
        "planned_end":    body.planned_end,
        "is_milestone":   body.is_milestone,
        "parent_task_id": body.parent_task_id,
    })
    task_id = result.scalar_one()

    # Assign users
    for uid in body.assignee_ids:
        await db.execute(text("""
            INSERT INTO task_assignees (task_id, user_id) VALUES (:task_id, :user_id)
            ON CONFLICT DO NOTHING
        """), {"task_id": task_id, "user_id": uid})

    await db.commit()
    return {"id": task_id, "message": "Task created."}





@router.get("/users")
async def list_users(db = Depends(get_db), user = Depends(get_current_user)):
    """Quick user list for assignee dropdowns"""
    result = await db.execute(text("""
        SELECT id, full_name, role FROM users
        WHERE is_active = TRUE ORDER BY full_name
    """))
    return [dict(r) for r in result.mappings()]


# ---- Delay proposals ----

@router.get("/delay-proposals")
async def list_delay_proposals(
    status: Optional[str] = Query("pending"),
    db     = Depends(get_db),
    user   = Depends(require_task_editor),
):
    result = await db.execute(text("""
        SELECT
            dp.id, dp.estimated_delay_days, dp.confidence, dp.reason,
            dp.detected_from, dp.original_end, dp.proposed_end,
            dp.status, dp.created_at, dp.review_notes,
            t.id AS task_id, t.title AS task_title, t.task_group,
            p.code AS project_code,
            u_prop.full_name AS proposed_by_name,
            u_rev.full_name  AS reviewed_by_name
        FROM task_delay_proposals dp
        JOIN tasks t    ON t.id  = dp.task_id
        JOIN projects p ON p.id  = t.project_id
        LEFT JOIN users u_prop ON u_prop.id = dp.proposed_by
        LEFT JOIN users u_rev  ON u_rev.id  = dp.reviewed_by
        WHERE (:status = 'all' OR dp.status = :status)
        ORDER BY dp.created_at DESC
        LIMIT 100
    """), {"status": status})
    return [dict(r) for r in result.mappings()]


@router.post("/delay-proposals/{proposal_id}/approve")
async def approve_delay_proposal(
    proposal_id: int,
    review_notes: Optional[str] = None,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    # Get proposal
    result = await db.execute(text("""
        SELECT task_id, proposed_end FROM task_delay_proposals
        WHERE id = :id AND status = 'pending'
    """), {"id": proposal_id})
    row = result.one_or_none()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "Proposal not found or already reviewed.")

    task_id, proposed_end = row

    current = await db.execute(text("SELECT status FROM tasks WHERE id = :id"), {"id": task_id})
    current_status = current.scalar_one()

    # Update task planned_end
    await db.execute(text("""
        UPDATE tasks SET planned_end = :proposed_end, updated_at = NOW()
        WHERE id = :task_id
    """), {"proposed_end": proposed_end, "task_id": task_id})

    # Mark proposal approved
    await db.execute(text("""
        UPDATE task_delay_proposals
        SET status = 'approved', reviewed_by = :uid,
            reviewed_at = NOW(), review_notes = :notes
        WHERE id = :id
    """), {"uid": user.id, "notes": review_notes, "id": proposal_id})

    # Write task history. This isn't a status change (only planned_end
    # moves), so old/new_status are both the task's current status — the
    # column is NOT NULL and a task_status enum, so it can't hold the
    # placeholder values ('scheduled'/'rescheduled') this used to write,
    # which aren't valid members of that enum in the first place.
    await db.execute(text("""
        INSERT INTO task_history (task_id, changed_by, old_status, new_status, notes)
        VALUES (:tid, :uid, :status, :status,
                'Timeline updated from delay proposal — new end: ' || :proposed_end_str)
    """), {"tid": task_id, "uid": user.id, "status": current_status, "proposed_end_str": str(proposed_end)})

    await db.commit()
    return {"message": "Delay approved. Task timeline updated."}


@router.post("/delay-proposals/{proposal_id}/dismiss")
async def dismiss_delay_proposal(
    proposal_id: int,
    review_notes: Optional[str] = None,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    await db.execute(text("""
        UPDATE task_delay_proposals
        SET status = 'dismissed', reviewed_by = :uid,
            reviewed_at = NOW(), review_notes = :notes
        WHERE id = :id AND status = 'pending'
    """), {"uid": user.id, "notes": review_notes, "id": proposal_id})
    await db.commit()
    return {"message": "Proposal dismissed."}


# ============================================================
# Project Templates
# ============================================================

class TemplateCreate(BaseModel):
    name:        str
    description: Optional[str] = None

class TemplateTaskCreate(BaseModel):
    title:          str
    description:    Optional[str] = None
    task_group:     Optional[str] = None
    priority:       str = 'normal'
    estimated_days: Optional[int] = None
    offset_days:    int = 0
    sort_order:     int = 0

class ApplyTemplate(BaseModel):
    project_id: int
    start_date: Optional[str] = None   # ISO date — tasks offset from this

@router.get("/templates")
async def list_templates(
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT pt.*, u.full_name AS created_by_name,
               COUNT(ptt.id) AS task_count
        FROM project_templates pt
        LEFT JOIN users u ON u.id = pt.created_by
        LEFT JOIN project_template_tasks ptt ON ptt.template_id = pt.id
        GROUP BY pt.id, u.full_name
        ORDER BY pt.name
    """))
    return [dict(r) for r in result.mappings()]


@router.get("/templates/{template_id}")
async def get_template(
    template_id: int,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text(
        "SELECT * FROM project_templates WHERE id = :id"
    ), {"id": template_id})
    tmpl = result.mappings().one_or_none()
    if not tmpl:
        raise HTTPException(404, "Template not found.")

    tasks = await db.execute(text(
        "SELECT * FROM project_template_tasks WHERE template_id = :id ORDER BY sort_order, id"
    ), {"id": template_id})
    return {**dict(tmpl), "tasks": [dict(t) for t in tasks.mappings()]}


@router.post("/templates", status_code=201)
async def create_template(
    body: TemplateCreate,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    result = await db.execute(text("""
        INSERT INTO project_templates (name, description, created_by)
        VALUES (:name, :description, :created_by)
        RETURNING id
    """), {"name": body.name, "description": body.description, "created_by": user.id})
    template_id = result.scalar_one()
    await db.commit()
    return {"id": template_id, "message": "Template created."}


@router.post("/templates/{template_id}/tasks", status_code=201)
async def add_template_task(
    template_id: int,
    body: TemplateTaskCreate,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    result = await db.execute(text("""
        INSERT INTO project_template_tasks
            (template_id, title, description, task_group,
             priority, estimated_days, offset_days, sort_order)
        VALUES
            (:template_id, :title, :description, :task_group,
             :priority, :estimated_days, :offset_days, :sort_order)
        RETURNING id
    """), {
        "template_id":    template_id,
        "title":          body.title,
        "description":    body.description,
        "task_group":     body.task_group,
        "priority":       body.priority,
        "estimated_days": body.estimated_days,
        "offset_days":    body.offset_days,
        "sort_order":     body.sort_order,
    })
    task_id = result.scalar_one()
    await db.commit()
    return {"id": task_id, "message": "Task added to template."}


@router.delete("/templates/{template_id}/tasks/{task_id}")
async def delete_template_task(
    template_id: int,
    task_id:     int,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    await db.execute(text(
        "DELETE FROM project_template_tasks WHERE id = :id AND template_id = :tid"
    ), {"id": task_id, "tid": template_id})
    await db.commit()
    return {"message": "Task removed."}


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: int,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    await db.execute(text(
        "DELETE FROM project_templates WHERE id = :id"
    ), {"id": template_id})
    await db.commit()
    return {"message": "Template deleted."}


@router.post("/templates/{template_id}/apply")
async def apply_template(
    template_id: int,
    body: ApplyTemplate,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    """Apply a template to a project — bulk-creates all template tasks."""
    from datetime import date, timedelta

    # Verify project exists
    proj = await db.execute(text(
        "SELECT id, name, start_date FROM projects WHERE id = :id"
    ), {"id": body.project_id})
    project = proj.mappings().one_or_none()
    if not project:
        raise HTTPException(404, "Project not found.")

    # Get template tasks
    tasks_result = await db.execute(text(
        "SELECT * FROM project_template_tasks WHERE template_id = :id ORDER BY sort_order, id"
    ), {"id": template_id})
    template_tasks = [dict(t) for t in tasks_result.mappings()]

    # Base date — provided or project start_date or today
    if body.start_date:
        base_date = date.fromisoformat(body.start_date)
    elif project["start_date"]:
        base_date = project["start_date"]
    else:
        base_date = date.today()

    created = []
    for t in template_tasks:
        planned_start = base_date + timedelta(days=t["offset_days"] or 0)
        planned_end   = planned_start + timedelta(days=t["estimated_days"] or 1)

        result = await db.execute(text("""
            INSERT INTO tasks
                (project_id, title, description, task_group,
                 priority, status, planned_start, planned_end, created_by)
            VALUES
                (:project_id, :title, :description, :task_group,
                 :priority, 'not_started', :planned_start, :planned_end, :created_by)
            RETURNING id
        """), {
            "project_id":    body.project_id,
            "title":         t["title"],
            "description":   t["description"],
            "task_group":    t["task_group"],
            "priority":      t["priority"],
            "planned_start": planned_start,
            "planned_end":   planned_end,
            "created_by":    user.id,
        })
        created.append(result.scalar_one())

    await db.commit()
    return {
        "tasks_created": len(created),
        "task_ids":      created,
        "message":       f"{len(created)} tasks created from template."
    }


@router.patch("/{task_id}")
async def update_task(
    task_id: int,
    body:    TaskUpdate,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update.")

    # Auto-set actual dates based on status
    if data.get("status") == "in_progress":
        data.setdefault("actual_start", date.today())
    if data.get("status") == "complete":
        data.setdefault("actual_end", date.today())

    set_clause = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = task_id

    old_result = await db.execute(text(
        "SELECT status FROM tasks WHERE id = :id"
    ), {"id": task_id})
    old_row = old_result.one_or_none()
    if not old_row:
        raise HTTPException(404, "Task not found.")
    old_status = old_row[0]

    await db.execute(text(
        f"UPDATE tasks SET {set_clause}, updated_at = NOW() WHERE id = :id"
    ), data)

    # Write history if status changed
    if "status" in data and data["status"] != old_status:
        await db.execute(text("""
            INSERT INTO task_history (task_id, changed_by, old_status, new_status, notes)
            VALUES (:task_id, :user_id, :old_status, :new_status, 'Updated via task editor')
        """), {
            "task_id":    task_id,
            "user_id":    user.id,
            "old_status": old_status,
            "new_status": data["status"],
        })

    await db.commit()
    return {"message": "Task updated."}


@router.patch("/{task_id}/status")
async def update_task_status(
    task_id: int,
    body:    StatusUpdate,
    db   = Depends(get_db),
    user = Depends(require_task_editor),
):
    valid = ['not_started', 'in_progress', 'blocked', 'complete']
    if body.status not in valid:
        raise HTTPException(400, f"Status must be one of: {valid}")

    old = await db.execute(text(
        "SELECT status FROM tasks WHERE id = :id"
    ), {"id": task_id})
    row = old.one_or_none()
    if not row:
        raise HTTPException(404, "Task not found.")

    extra = {}
    if body.status == 'in_progress':
        extra["actual_start"] = date.today()
    if body.status == 'complete':
        extra["actual_end"] = date.today()

    extra_sql = "".join(f", {k} = :{k}" for k in extra)
    params = {"id": task_id, "status": body.status, **extra}

    await db.execute(text(
        f"UPDATE tasks SET status = :status{extra_sql}, updated_at = NOW() WHERE id = :id"
    ), params)

    await db.execute(text("""
        INSERT INTO task_history (task_id, changed_by, old_status, new_status)
        VALUES (:task_id, :user_id, :old_status, :new_status)
    """), {"task_id": task_id, "user_id": user.id, "old_status": row[0], "new_status": body.status})

    await db.commit()
    return {"message": "Status updated."}
