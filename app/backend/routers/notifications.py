"""routers/notifications.py — Notification endpoints"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from core.database import get_db
from core.security import get_current_user

router = APIRouter()

@router.get("")
async def list_notifications(
    unread: bool = Query(False),
    db = Depends(get_db), user = Depends(get_current_user)
):
    where = "AND is_read = FALSE" if unread else ""
    result = await db.execute(text(f"""
        SELECT id, notification_type, title, message, is_read, created_at
        FROM notifications
        WHERE recipient_id = :uid {where}
        ORDER BY created_at DESC LIMIT 50
    """), {"uid": user.id})
    return [dict(r) for r in result.mappings()]

@router.patch("/{notif_id}/read")
async def mark_read(notif_id: int, db = Depends(get_db), user = Depends(get_current_user)):
    await db.execute(text("""
        UPDATE notifications SET is_read = TRUE WHERE id = :id AND recipient_id = :uid
    """), {"id": notif_id, "uid": user.id})
    await db.commit()
    return {"message": "Marked as read."}
