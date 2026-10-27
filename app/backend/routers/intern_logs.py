"""
routers/intern_logs.py — Student intern presence tracking

Deliberately separate from daily_logs: just a name, hours, and a summary
per day. Not tied to a project, task, or consumable, and never read by
the weekly-report, budget, or consumable-usage logic.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel
from datetime import date

from core.database import get_db
from core.security import require_intern, require_intern_access

router = APIRouter()


class InternLogIn(BaseModel):
    log_date: Optional[date] = None   # defaults to today
    hours:    float
    summary:  Optional[str] = None


@router.get("/me")
async def list_my_intern_logs(
    db   = Depends(get_db),
    user = Depends(require_intern),
):
    result = await db.execute(text("""
        SELECT id, log_date, hours, summary
        FROM intern_logs WHERE user_id = :uid
        ORDER BY log_date DESC
        LIMIT 60
    """), {"uid": user.id})
    return [dict(r) for r in result.mappings()]


@router.post("")
async def log_intern_hours(
    body: InternLogIn,
    db   = Depends(get_db),
    user = Depends(require_intern),
):
    if body.hours <= 0 or body.hours > 24:
        raise HTTPException(400, "Hours must be between 0 and 24.")

    result = await db.execute(text("""
        INSERT INTO intern_logs (user_id, log_date, hours, summary)
        VALUES (:uid, COALESCE(:log_date, CURRENT_DATE), :hours, :summary)
        ON CONFLICT (user_id, log_date) DO UPDATE SET
            hours = EXCLUDED.hours, summary = EXCLUDED.summary, updated_at = NOW()
        RETURNING id
    """), {
        "uid": user.id, "log_date": body.log_date,
        "hours": body.hours, "summary": body.summary,
    })
    log_id = result.scalar_one()
    await db.commit()
    return {"id": log_id, "message": "Hours logged."}


@router.get("")
async def list_all_intern_logs(
    db   = Depends(get_db),
    user = Depends(require_intern_access),
):
    result = await db.execute(text("""
        SELECT il.id, il.log_date, il.hours, il.summary, u.full_name
        FROM intern_logs il
        JOIN users u ON u.id = il.user_id
        ORDER BY il.log_date DESC, u.full_name
        LIMIT 500
    """))
    return [dict(r) for r in result.mappings()]


@router.delete("/{log_id}")
async def delete_intern_log(
    log_id: int,
    db   = Depends(get_db),
    user = Depends(require_intern_access),
):
    result = await db.execute(text(
        "DELETE FROM intern_logs WHERE id = :id RETURNING id"
    ), {"id": log_id})
    if not result.one_or_none():
        raise HTTPException(404, "Entry not found.")

    await db.commit()
    return {"message": "Entry deleted."}
