"""
routers/dashboard.py — Dashboard stats endpoint
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from core.database import get_db
from core.security import get_current_user

router = APIRouter()


@router.get("/stats")
async def dashboard_stats(
    db:           AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Returns summary counts for the dashboard stat cards."""
    result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM purchase_orders
             WHERE status NOT IN ('closed','rejected')) AS open_pos,
            (SELECT COUNT(*) FROM purchase_orders
             WHERE status = 'pending') AS pending_approval,
            (SELECT COUNT(*) FROM consumables
             WHERE is_active = TRUE AND current_stock <= reorder_threshold) AS restock_flags,
            (SELECT COUNT(*) FROM projects
             WHERE is_active = TRUE) AS active_projects,
            (SELECT COUNT(*) FROM missing_log_flags
             WHERE resolved = FALSE
               AND missing_date = CURRENT_DATE - 1) AS missing_logs
    """))
    row = dict(result.mappings().one())
    # Missing-logs alert is ops_manager/ceo only per PERMISSIONS.md.
    if current_user.role not in ("ops_manager", "ceo"):
        row["missing_logs"] = None
    return row
