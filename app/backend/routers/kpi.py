"""routers/kpi.py — KPI tracking endpoints"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional, List
from pydantic import BaseModel
from datetime import date
from core.database import get_db
from core.security import require_roles, require_kpi_access, require_kpi_manager

router = APIRouter()

# ---- Schemas ----

class KpiTargetCreate(BaseModel):
    metric_type:    str = 'custom'
    metric_name:    str
    description:    Optional[str]  = None
    target_value:   float
    unit:           str = '%'
    period:         str = 'weekly'
    user_id:        Optional[int]  = None
    project_id:     Optional[int]  = None
    effective_from: date = date.today()
    effective_to:   Optional[date] = None
    is_system:      bool = False

# ---- Endpoints ----

@router.get("")
async def kpi_summary(
    period: Optional[str] = Query(None),
    db     = Depends(get_db),
    user   = Depends(require_roles("ops_manager")),
):
    params = {}
    where  = ["kt.is_active = TRUE"]
    if period:
        where.append("kt.period = :period")
        params["period"] = period

    where_sql = "WHERE " + " AND ".join(where)

    result = await db.execute(text(f"""
        SELECT
            kt.id               AS kpi_target_id,
            kt.metric_name,
            kt.metric_type,
            kt.period,
            kt.target_value,
            kt.unit,
            kt.is_system,
            u.full_name         AS employee,
            p.code              AS project_code,
            ka.period_start,
            ka.period_end,
            ka.actual_value,
            ka.met_target,
            ROUND(ka.actual_value - kt.target_value, 1) AS variance,
            ka.computed_at
        FROM kpi_targets kt
        LEFT JOIN kpi_actuals ka ON ka.kpi_target_id = kt.id
        LEFT JOIN users u        ON u.id = COALESCE(ka.user_id, kt.user_id)
        LEFT JOIN projects p     ON p.id = COALESCE(ka.project_id, kt.project_id)
        {where_sql}
        ORDER BY ka.period_start DESC NULLS LAST, kt.metric_type, u.full_name
    """), params)
    return [dict(r) for r in result.mappings()]


@router.get("/targets")
async def list_targets(
    db   = Depends(get_db),
    user = Depends(require_kpi_access),
):
    result = await db.execute(text("""
        SELECT kt.*, u.full_name AS employee, p.code AS project_code
        FROM kpi_targets kt
        LEFT JOIN users u    ON u.id = kt.user_id
        LEFT JOIN projects p ON p.id = kt.project_id
        WHERE kt.is_active = TRUE
        ORDER BY kt.period, kt.metric_type
    """))
    return [dict(r) for r in result.mappings()]


@router.post("/targets", status_code=status.HTTP_201_CREATED)
async def create_target(
    body: KpiTargetCreate,
    db   = Depends(get_db),
    user = Depends(require_kpi_manager),
):
    result = await db.execute(text("""
        INSERT INTO kpi_targets
            (metric_type, metric_name, description, target_value, unit,
             period, user_id, project_id, effective_from, effective_to,
             is_system, is_active, created_by)
        VALUES
            (:metric_type, :metric_name, :description, :target_value, :unit,
             :period, :user_id, :project_id, :effective_from, :effective_to,
             :is_system, TRUE, :created_by)
        RETURNING id
    """), {
        **body.model_dump(),
        "created_by": user.id,
    })
    target_id = result.scalar_one()
    await db.commit()
    return {"id": target_id, "message": "KPI target created."}


@router.patch("/targets/{target_id}/deactivate")
async def deactivate_target(
    target_id: int,
    db   = Depends(get_db),
    user = Depends(require_kpi_manager),
):
    await db.execute(text(
        "UPDATE kpi_targets SET is_active = FALSE WHERE id = :id"
    ), {"id": target_id})
    await db.commit()
    return {"message": "Target deactivated."}


@router.post("/compute")
async def compute_kpis(
    period: str = Query("weekly"),
    db     = Depends(get_db),
    user   = Depends(require_roles("ops_manager")),
):
    if period not in ("weekly", "monthly"):
        raise HTTPException(400, "Period must be 'weekly' or 'monthly'.")
    result = await db.execute(text(
        "SELECT fn_compute_kpi_actuals(:p::kpi_period)"
    ), {"p": period})
    count = result.scalar_one()
    await db.commit()
    return {"message": f"Computed {count} KPI records.", "period": period}
