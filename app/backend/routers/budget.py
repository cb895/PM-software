"""routers/budget.py — Budget tracker endpoints"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel
from datetime import date
from core.database import get_db
from core.security import require_roles, require_budget_access

router = APIRouter()

# ---- Schemas ----

class ProjectBudgetUpdate(BaseModel):
    budget_allocated:       Optional[float] = None
    hourly_rate:            Optional[float] = None
    budget_alert_threshold: Optional[float] = None

class PhaseBudgetUpdate(BaseModel):
    budget_allocated:       Optional[float] = None
    hourly_rate:            Optional[float] = None
    budget_alert_threshold: Optional[float] = None
    phase_name:             Optional[str]   = None
    start_date:             Optional[str]   = None
    end_date:               Optional[str]   = None

class ManualEntryCreate(BaseModel):
    project_id:   int
    phase_id:     Optional[int] = None
    entry_type:   str           # 'labour' | 'consumable' | 'purchase_order'
    description:  Optional[str] = None
    amount:       float
    entry_date:   Optional[str] = None

# ---- Endpoints ----

@router.get("/summary")
async def budget_summary(
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    result = await db.execute(text(
        "SELECT * FROM project_budget_summary ORDER BY project_name"
    ))
    return [dict(r) for r in result.mappings()]


@router.get("/phases")
async def phase_summary(
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    result = await db.execute(text(
        "SELECT * FROM phase_budget_summary ORDER BY project_name, phase_number"
    ))
    return [dict(r) for r in result.mappings()]


@router.get("/entries")
async def list_entries(
    project_id: Optional[int] = Query(None),
    entry_type: Optional[str] = Query(None),
    limit:      int = Query(100, le=500),
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    params = {"limit": limit}
    where  = []
    if project_id:
        where.append("be.project_id = :project_id")
        params["project_id"] = project_id
    if entry_type:
        where.append("be.entry_type = :entry_type")
        params["entry_type"] = entry_type

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    result = await db.execute(text(f"""
        SELECT
            be.id, be.entry_type, be.description, be.amount, be.entry_date,
            be.created_at, be.reference_type, be.reference_id,
            p.code  AS project_code,
            p.name  AS project_name,
            pp.phase_name
        FROM budget_entries be
        JOIN projects p         ON p.id  = be.project_id
        LEFT JOIN project_phases pp ON pp.id = be.phase_id
        {where_sql}
        ORDER BY be.entry_date DESC, be.id DESC
        LIMIT :limit
    """), params)
    return [dict(r) for r in result.mappings()]


@router.patch("/projects/{project_id}")
async def update_project_budget(
    project_id: int,
    body: ProjectBudgetUpdate,
    db   = Depends(get_db),
    user = Depends(require_budget_access),
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
    return {"message": "Project budget updated."}


@router.get("/projects/{project_id}")
async def project_budget_detail(
    project_id: int,
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    # Project summary
    proj = await db.execute(text("""
        SELECT * FROM project_budget_summary WHERE project_id = :id
    """), {"id": project_id})
    row = proj.mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Project not found.")

    # Phase breakdowns
    phases = await db.execute(text("""
        SELECT * FROM phase_budget_summary WHERE project_code = :code
        ORDER BY phase_number
    """), {"code": row["project_code"]})

    # Recent entries
    entries = await db.execute(text("""
        SELECT be.*, pp.phase_name
        FROM budget_entries be
        LEFT JOIN project_phases pp ON pp.id = be.phase_id
        WHERE be.project_id = :id
        ORDER BY be.entry_date DESC
        LIMIT 100
    """), {"id": project_id})

    return {
        **dict(row),
        "phases":  [dict(r) for r in phases.mappings()],
        "entries": [dict(r) for r in entries.mappings()],
    }


@router.patch("/phases/{phase_id}")
async def update_phase_budget(
    phase_id: int,
    body: PhaseBudgetUpdate,
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update.")

    set_clause = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = phase_id

    await db.execute(text(
        f"UPDATE project_phases SET {set_clause} WHERE id = :id"
    ), data)
    await db.commit()
    return {"message": "Phase budget updated."}


@router.post("/entries/manual")
async def create_manual_entry(
    body: ManualEntryCreate,
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    """Manual budget entry for corrections or adjustments not auto-posted."""
    if body.entry_type not in ('labour', 'consumable', 'purchase_order'):
        raise HTTPException(400, "Invalid entry_type.")

    result = await db.execute(text("""
        INSERT INTO budget_entries
            (project_id, phase_id, entry_type, description, amount, entry_date, created_by)
        VALUES
            (:project_id, :phase_id, :entry_type, :description, :amount,
             COALESCE(:entry_date::DATE, CURRENT_DATE), :created_by)
        RETURNING id
    """), {
        "project_id":  body.project_id,
        "phase_id":    body.phase_id,
        "entry_type":  body.entry_type,
        "description": body.description,
        "amount":      body.amount,
        "entry_date":  body.entry_date,
        "created_by":  user.id,
    })
    entry_id = result.scalar_one()

    # Check budget alert after manual entry
    await db.execute(text(
        "SELECT fn_check_budget_alert(:pid, :phid)"
    ), {"pid": body.project_id, "phid": body.phase_id})

    await db.commit()
    return {"id": entry_id, "message": "Manual entry created."}


# ============================================================
# Overhead Expenses
# ============================================================

class OverheadCreate(BaseModel):
    name:         str
    description:  Optional[str]   = None
    amount:       float
    is_recurring: bool             = False
    frequency:    Optional[str]    = None   # weekly | monthly | yearly
    start_date:   Optional[date]   = None
    end_date:     Optional[date]   = None
    category:     Optional[str]    = None

class OverheadUpdate(BaseModel):
    name:         Optional[str]   = None
    description:  Optional[str]   = None
    amount:       Optional[float] = None
    is_recurring: Optional[bool]  = None
    frequency:    Optional[str]   = None
    start_date:   Optional[date]  = None
    end_date:     Optional[date]  = None
    category:     Optional[str]   = None


@router.get("/overhead")
async def list_overhead(
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    result = await db.execute(text("""
        SELECT oe.*, u.full_name AS created_by_name
        FROM overhead_expenses oe
        LEFT JOIN users u ON u.id = oe.created_by
        ORDER BY oe.is_recurring DESC, oe.name
    """))
    return [dict(r) for r in result.mappings()]


@router.post("/overhead", status_code=201)
async def create_overhead(
    body: OverheadCreate,
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    result = await db.execute(text("""
        INSERT INTO overhead_expenses
            (name, description, amount, is_recurring, frequency,
             start_date, end_date, category, created_by)
        VALUES
            (:name, :description, :amount, :is_recurring, :frequency,
             :start_date, :end_date, :category, :created_by)
        RETURNING id
    """), {
        "name":         body.name,
        "description":  body.description,
        "amount":       body.amount,
        "is_recurring": body.is_recurring,
        "frequency":    body.frequency,
        "start_date":   body.start_date,
        "end_date":     body.end_date,
        "category":     body.category,
        "created_by":   user.id,
    })
    expense_id = result.scalar_one()
    await db.commit()
    return {"id": expense_id, "message": "Overhead expense added."}


@router.patch("/overhead/{expense_id}")
async def update_overhead(
    expense_id: int,
    body: OverheadUpdate,
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update.")
    set_clause = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = expense_id
    await db.execute(text(
        f"UPDATE overhead_expenses SET {set_clause}, updated_at = NOW() WHERE id = :id"
    ), data)
    await db.commit()
    return {"message": "Expense updated."}


@router.delete("/overhead/{expense_id}")
async def delete_overhead(
    expense_id: int,
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    await db.execute(text(
        "DELETE FROM overhead_expenses WHERE id = :id"
    ), {"id": expense_id})
    await db.commit()
    return {"message": "Expense removed."}


@router.get("/overhead/entries")
async def get_overhead_entries(
    db   = Depends(get_db),
    user = Depends(require_budget_access),
):
    """Returns all overhead budget entries — overhead PO payments and manual overhead expenses."""
    result = await db.execute(text("""
        SELECT
            be.id, be.entry_type, be.description,
            be.amount, be.entry_date, be.is_overhead,
            be.reference_type, be.reference_id,
            po.po_number,
            COALESCE(s.name, po.supplier_name_free) AS supplier
        FROM budget_entries be
        LEFT JOIN invoices inv ON inv.id = be.reference_id
            AND be.reference_type = 'invoice'
        LEFT JOIN purchase_orders po ON po.id = inv.po_id
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE be.is_overhead = TRUE
        ORDER BY be.entry_date DESC
        LIMIT 200
    """))
    return [dict(r) for r in result.mappings()]
