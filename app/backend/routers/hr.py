"""
routers/hr.py — HR Portal endpoints
Time off requests, staff calendar, in/out status, leave balances
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional, List
from pydantic import BaseModel
from datetime import date, datetime
from core.database import get_db
from core.security import get_current_user, require_roles
from services.document_service import dispatch_leave_approved

router = APIRouter()

# ---- Schemas ----

class LeaveRequestCreate(BaseModel):
    leave_type:   str
    start_date:   date
    end_date:     date
    notes:        Optional[str] = None
    approx_days:  Optional[int] = None   # for open-ended leave types

class LeaveReview(BaseModel):
    action:       str   # 'approved' | 'denied'
    review_notes: Optional[str] = None

class StatusUpdate(BaseModel):
    status:       str   # 'in_office' | 'remote' | 'off' | 'sick'
    status_note:  Optional[str] = None

class ScheduleOverride(BaseModel):
    week_start:      date
    override_day_off: Optional[int] = None  # 0-6, None = revert to default
    override_reason:  Optional[str] = None

class EventCreate(BaseModel):
    title:        str
    description:  Optional[str] = None
    event_type:   str = 'team'   # 'team' | 'one_on_one' | 'private'
    start_time:   datetime
    end_time:     datetime
    all_day:      bool = False
    location:     Optional[str] = None
    participant_ids: List[int] = []

class BalanceUpdate(BaseModel):
    pto_total: Optional[float] = None
    pto_used:  Optional[float] = None

# ---- In/Out Status ----

@router.get("/status")
async def get_staff_status(
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """Today's in/out board — all active staff."""
    result = await db.execute(text(
        "SELECT * FROM staff_status_today"
    ))
    return [dict(r) for r in result.mappings()]


@router.patch("/status/me")
async def update_my_status(
    body: StatusUpdate,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """Any user can update their own in/out status."""
    valid = ['in_office', 'remote', 'off', 'sick']
    if body.status not in valid:
        raise HTTPException(400, f"Status must be one of: {valid}")

    await db.execute(text("""
        INSERT INTO staff_status (user_id, status, status_note, manual_override, override_by, last_updated)
        VALUES (:uid, :status, :note, TRUE, :uid, NOW())
        ON CONFLICT (user_id) DO UPDATE
            SET status          = :status,
                status_note     = :note,
                manual_override = TRUE,
                override_by     = :uid,
                last_updated    = NOW()
    """), {"uid": user.id, "status": body.status, "note": body.status_note})
    await db.commit()
    return {"message": "Status updated."}


@router.patch("/status/{user_id}")
async def update_user_status(
    user_id: int,
    body:    StatusUpdate,
    db       = Depends(get_db),
    user     = Depends(require_roles("ops_manager")),
):
    """Ops manager can update any user's status."""
    valid = ['in_office', 'remote', 'off', 'sick']
    if body.status not in valid:
        raise HTTPException(400, f"Status must be one of: {valid}")

    await db.execute(text("""
        INSERT INTO staff_status (user_id, status, status_note, manual_override, override_by, last_updated)
        VALUES (:uid, :status, :note, TRUE, :by, NOW())
        ON CONFLICT (user_id) DO UPDATE
            SET status          = :status,
                status_note     = :note,
                manual_override = TRUE,
                override_by     = :by,
                last_updated    = NOW()
    """), {"uid": user_id, "status": body.status, "note": body.status_note, "by": user.id})
    await db.commit()
    return {"message": "Status updated."}


@router.post("/status/sync")
async def sync_status(
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    """Manually trigger auto-sync of statuses from approved leave."""
    await db.execute(text("SELECT fn_sync_staff_status()"))
    await db.commit()
    return {"message": "Staff statuses synced from leave data."}


# ---- Leave Requests ----

@router.get("/leave")
async def list_leave_requests(
    status_filter: Optional[str] = Query(None, alias="status"),
    user_id:       Optional[int] = Query(None),
    db    = Depends(get_db),
    user  = Depends(get_current_user),
):
    params = {}
    where  = []

    # Non-ops-managers only see their own requests
    if user.role != "ops_manager":
        where.append("lr.user_id = :my_id")
        params["my_id"] = user.id
    elif user_id:
        where.append("lr.user_id = :user_id")
        params["user_id"] = user_id

    if status_filter:
        where.append("lr.status = :status")
        params["status"] = status_filter

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    result = await db.execute(text(f"""
        SELECT
            lr.id, lr.leave_type, lr.start_date, lr.end_date,
            lr.days_requested, lr.notes, lr.approx_days,
            lr.status, lr.review_notes, lr.reviewed_at,
            lr.hr_meeting_required, lr.hr_meeting_date,
            lr.created_at,
            u.full_name     AS employee,
            u.email         AS employee_email,
            rev.full_name   AS reviewed_by_name
        FROM leave_requests lr
        JOIN users u          ON u.id   = lr.user_id
        LEFT JOIN users rev   ON rev.id = lr.reviewed_by
        {where_sql}
        ORDER BY lr.created_at DESC
    """), params)
    return [dict(r) for r in result.mappings()]


@router.post("/leave", status_code=status.HTTP_201_CREATED)
async def submit_leave_request(
    body: LeaveRequestCreate,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    if body.end_date < body.start_date:
        raise HTTPException(400, "End date must be on or after start date.")

    # Calculate business days
    result = await db.execute(text(
        "SELECT fn_business_days(:s, :e)"
    ), {"s": body.start_date, "e": body.end_date})
    business_days = float(result.scalar_one())

    # For vacation: check balance
    if body.leave_type == 'vacation':
        bal = await db.execute(text("""
            SELECT pto_total - pto_used - pto_pending AS available
            FROM leave_balances
            WHERE user_id = :uid AND year = :yr
        """), {"uid": user.id, "yr": body.start_date.year})
        row = bal.one_or_none()
        if not row or row[0] < business_days:
            available = row[0] if row else 0
            raise HTTPException(400, f"Insufficient PTO balance. Available: {available:.1f} days, requested: {business_days:.1f} days.")

    ins = await db.execute(text("""
        INSERT INTO leave_requests
            (user_id, leave_type, start_date, end_date,
             days_requested, notes, approx_days, status)
        VALUES
            (:user_id, :leave_type, :start_date, :end_date,
             :days, :notes, :approx_days, 'pending')
        RETURNING id
    """), {
        "user_id":    user.id,
        "leave_type": body.leave_type,
        "start_date": body.start_date,
        "end_date":   body.end_date,
        "days":       business_days,
        "notes":      body.notes,
        "approx_days":body.approx_days,
    })
    request_id = ins.scalar_one()

    # For vacation: update pending balance
    if body.leave_type == 'vacation':
        await db.execute(text("""
            UPDATE leave_balances
            SET pto_pending = pto_pending + :days, updated_at = NOW()
            WHERE user_id = :uid AND year = :yr
        """), {"days": business_days, "uid": user.id, "yr": body.start_date.year})

    # Notify ops manager
    await db.execute(text("""
        INSERT INTO notifications (recipient_id, notification_type, title, message, reference_id, reference_type)
        SELECT id, 'leave_request',
               :name || ' submitted a ' || :type || ' request',
               :days_msg || ' days from ' || :start || ' to ' || :end,
               :ref_id, 'leave_request'
        FROM users WHERE role = 'ops_manager' AND is_active = TRUE
    """), {
        "name":     user.full_name,
        "type":     body.leave_type,
        "days_msg": str(int(business_days)),
        "start":    str(body.start_date),
        "end":      str(body.end_date),
        "ref_id":   request_id,
    })

    await db.commit()
    return {"id": request_id, "days_requested": business_days, "message": "Leave request submitted."}


@router.get("/leave/{request_id}")
async def get_leave_request(
    request_id: int,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT lr.*, u.full_name AS employee, rev.full_name AS reviewed_by_name
        FROM leave_requests lr
        JOIN users u ON u.id = lr.user_id
        LEFT JOIN users rev ON rev.id = lr.reviewed_by
        WHERE lr.id = :id
    """), {"id": request_id})
    row = result.mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Request not found.")
    if user.role != "ops_manager" and row["user_id"] != user.id:
        raise HTTPException(403, "Access denied.")
    return dict(row)


@router.post("/leave/{request_id}/review")
async def review_leave_request(
    request_id: int,
    body: LeaveReview,
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    if body.action not in ('approved', 'denied'):
        raise HTTPException(400, "Action must be 'approved' or 'denied'.")

    result = await db.execute(text("""
        SELECT user_id, leave_type, days_requested, start_date, end_date, status
        FROM leave_requests WHERE id = :id
    """), {"id": request_id})
    req = result.mappings().one_or_none()
    if not req:
        raise HTTPException(404, "Request not found.")
    if req["status"] != 'pending':
        raise HTTPException(400, "Only pending requests can be reviewed.")

    await db.execute(text("""
        UPDATE leave_requests
        SET status = :action, reviewed_by = :by,
            reviewed_at = NOW(), review_notes = :notes,
            hr_meeting_required = CASE
                WHEN :action = 'approved' AND leave_type = 'sick' AND days_requested >= 5
                THEN TRUE ELSE hr_meeting_required END
        WHERE id = :id
    """), {"action": body.action, "by": user.id, "notes": body.review_notes, "id": request_id})

    # Handle PTO balance on approve/deny
    if req["leave_type"] == 'vacation':
        if body.action == 'approved':
            await db.execute(text("""
                UPDATE leave_balances
                SET pto_pending = GREATEST(pto_pending - :days, 0),
                    pto_used    = pto_used + :days,
                    updated_at  = NOW()
                WHERE user_id = :uid AND year = :yr
            """), {"days": req["days_requested"], "uid": req["user_id"],
                   "yr": req["start_date"].year})
        elif body.action == 'denied':
            await db.execute(text("""
                UPDATE leave_balances
                SET pto_pending = GREATEST(pto_pending - :days, 0),
                    updated_at  = NOW()
                WHERE user_id = :uid AND year = :yr
            """), {"days": req["days_requested"], "uid": req["user_id"],
                   "yr": req["start_date"].year})

    # If approved, auto-add to calendar
    if body.action == 'approved':
        await db.execute(text("""
            INSERT INTO calendar_events
                (title, event_type, start_time, end_time, all_day, created_by, related_leave_id)
            SELECT
                u.full_name || ' — ' || :leave_type,
                'team', :start, :end, TRUE, :by, :ref_id
            FROM users u WHERE u.id = :uid
        """), {
            "leave_type": req["leave_type"],
            "start":      req["start_date"],
            "end":        req["end_date"],
            "by":         user.id,
            "ref_id":     request_id,
            "uid":        req["user_id"],
        })

        # Sync status if leave starts today
        await db.execute(text("SELECT fn_sync_staff_status()"))

    # Notify the employee
    action_label = "approved" if body.action == "approved" else "denied"
    await db.execute(text("""
        INSERT INTO notifications (recipient_id, notification_type, title, message, reference_id, reference_type)
        VALUES (:uid, 'leave_request', 'Leave request ' || :action,
                'Your ' || :leave_type || ' request has been ' || :action || '.',
                :ref_id, 'leave_request')
    """), {
        "uid":        req["user_id"],
        "action":     action_label,
        "leave_type": req["leave_type"],
        "ref_id":     request_id,
    })

    if body.action == "approved":
        dispatch_leave_approved(request_id)
    await db.commit()
    return {"message": f"Request {action_label}."}


@router.post("/leave/{request_id}/cancel")
async def cancel_leave_request(
    request_id: int,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text(
        "SELECT user_id, leave_type, days_requested, start_date, status FROM leave_requests WHERE id = :id"
    ), {"id": request_id})
    req = result.mappings().one_or_none()
    if not req:
        raise HTTPException(404, "Request not found.")
    if req["user_id"] != user.id and user.role != "ops_manager":
        raise HTTPException(403, "Access denied.")
    if req["status"] == 'cancelled':
        raise HTTPException(400, "Already cancelled.")

    old_status = req["status"]
    await db.execute(text(
        "UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE id = :id"
    ), {"id": request_id})

    # Release balance
    if req["leave_type"] == 'vacation':
        if old_status == 'pending':
            await db.execute(text("""
                UPDATE leave_balances
                SET pto_pending = GREATEST(pto_pending - :days, 0), updated_at = NOW()
                WHERE user_id = :uid AND year = :yr
            """), {"days": req["days_requested"], "uid": req["user_id"], "yr": req["start_date"].year})
        elif old_status == 'approved':
            await db.execute(text("""
                UPDATE leave_balances
                SET pto_used = GREATEST(pto_used - :days, 0), updated_at = NOW()
                WHERE user_id = :uid AND year = :yr
            """), {"days": req["days_requested"], "uid": req["user_id"], "yr": req["start_date"].year})

    await db.commit()
    return {"message": "Request cancelled."}


# ---- Leave Balances ----

@router.get("/balances")
async def get_balances(
    year: int = Query(2026),
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    if user.role == "ops_manager":
        result = await db.execute(text("""
            SELECT lb.*, u.full_name, u.email,
                   GREATEST(lb.pto_total - lb.pto_used - lb.pto_pending, 0) AS pto_available
            FROM leave_balances lb JOIN users u ON u.id = lb.user_id
            WHERE lb.year = :yr ORDER BY u.full_name
        """), {"yr": year})
    else:
        result = await db.execute(text("""
            SELECT lb.*, u.full_name, u.email,
                   GREATEST(lb.pto_total - lb.pto_used - lb.pto_pending, 0) AS pto_available
            FROM leave_balances lb JOIN users u ON u.id = lb.user_id
            WHERE lb.year = :yr AND lb.user_id = :uid
        """), {"yr": year, "uid": user.id})
    return [dict(r) for r in result.mappings()]


@router.patch("/balances/{user_id}")
async def update_balance(
    user_id: int,
    body:    BalanceUpdate,
    year:    int = Query(2026),
    db       = Depends(get_db),
    user     = Depends(require_roles("ops_manager")),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update.")
    set_clause = ", ".join(f"{k} = :{k}" for k in data)
    data.update({"user_id": user_id, "year": year})
    await db.execute(text(
        f"UPDATE leave_balances SET {set_clause}, updated_at = NOW() WHERE user_id = :user_id AND year = :year"
    ), data)
    await db.commit()
    return {"message": "Balance updated."}


# ---- Calendar ----

@router.get("/calendar")
async def get_calendar_events(
    start: Optional[date] = Query(None),
    end:   Optional[date] = Query(None),
    db     = Depends(get_db),
    user   = Depends(get_current_user),
):
    # Team events: all can see
    # One-on-one: only participants + ops manager
    # Private: creator + ops manager only
    params = {"uid": user.id}
    where  = []

    if start:
        where.append("ce.start_time >= :start")
        params["start"] = start
    if end:
        where.append("ce.start_time <= :end")
        params["end"] = end

    where_sql = ("AND " + " AND ".join(where)) if where else ""

    result = await db.execute(text(f"""
        SELECT DISTINCT
            ce.id, ce.title, ce.description, ce.event_type,
            ce.start_time, ce.end_time, ce.all_day, ce.location,
            ce.is_recurring, ce.recurrence_rule, ce.related_leave_id,
            ce.created_at,
            u.full_name AS created_by_name,
            ARRAY_AGG(DISTINCT p.full_name)
                FILTER (WHERE p.id IS NOT NULL) AS participants
        FROM calendar_events ce
        JOIN users u ON u.id = ce.created_by
        LEFT JOIN calendar_event_participants cep ON cep.event_id = ce.id
        LEFT JOIN users p ON p.id = cep.user_id
        WHERE (
            ce.event_type = 'team'
            OR (ce.event_type = 'one_on_one' AND (
                ce.created_by = :uid OR
                cep.user_id   = :uid OR
                (SELECT role FROM users WHERE id = :uid) = 'ops_manager'
            ))
            OR (ce.event_type = 'private' AND (
                ce.created_by = :uid OR
                (SELECT role FROM users WHERE id = :uid) = 'ops_manager'
            ))
        )
        {where_sql}
        GROUP BY ce.id, u.full_name
        ORDER BY ce.start_time
    """), params)
    return [dict(r) for r in result.mappings()]


@router.post("/calendar", status_code=status.HTTP_201_CREATED)
async def create_event(
    body: EventCreate,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    if body.end_time <= body.start_time:
        raise HTTPException(400, "End time must be after start time.")

    result = await db.execute(text("""
        INSERT INTO calendar_events
            (title, description, event_type, start_time, end_time,
             all_day, location, created_by)
        VALUES
            (:title, :description, :event_type, :start_time, :end_time,
             :all_day, :location, :created_by)
        RETURNING id
    """), {
        "title":       body.title,
        "description": body.description,
        "event_type":  body.event_type,
        "start_time":  body.start_time,
        "end_time":    body.end_time,
        "all_day":     body.all_day,
        "location":    body.location,
        "created_by":  user.id,
    })
    event_id = result.scalar_one()

    # Always add creator as participant
    participant_ids = list(set([user.id] + body.participant_ids))
    for pid in participant_ids:
        response = "accepted" if pid == user.id else "pending"
        await db.execute(text("""
            INSERT INTO calendar_event_participants (event_id, user_id, response)
            VALUES (:eid, :uid, :response)
            ON CONFLICT DO NOTHING
        """), {"eid": event_id, "uid": pid, "response": response})

    await db.commit()
    return {"id": event_id, "message": "Event created."}


@router.delete("/calendar/{event_id}")
async def delete_event(
    event_id: int,
    db        = Depends(get_db),
    user      = Depends(get_current_user),
):
    result = await db.execute(text(
        "SELECT created_by, related_leave_id FROM calendar_events WHERE id = :id"
    ), {"id": event_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Event not found.")
    if row[0] != user.id and user.role != "ops_manager":
        raise HTTPException(403, "Only the event creator or ops manager can delete events.")
    if row[1]:
        raise HTTPException(400, "This event is linked to an approved leave request and cannot be deleted directly.")

    await db.execute(text("DELETE FROM calendar_events WHERE id = :id"), {"id": event_id})
    await db.commit()
    return {"message": "Event deleted."}


# ---- Patricia's Schedule Overrides ----

@router.get("/schedule/pw")
async def get_pw_schedule(
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """Get Patricia's schedule overrides for the next 12 weeks."""
    result = await db.execute(text("""
        SELECT wo.*, u_set.full_name AS set_by_name
        FROM work_schedule_overrides wo
        JOIN users pw ON pw.id = wo.user_id
        LEFT JOIN users u_set ON u_set.id = wo.set_by
        WHERE pw.email = 'pw@metabolictrack.com'
          AND wo.week_start >= date_trunc('week', CURRENT_DATE)::DATE
        ORDER BY wo.week_start
        LIMIT 12
    """))
    return [dict(r) for r in result.mappings()]


@router.patch("/schedule/pw")
async def update_pw_schedule(
    body: ScheduleOverride,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """Patricia or ops manager can override her day off for a given week."""
    pw_result = await db.execute(text(
        "SELECT id FROM users WHERE email = 'pw@metabolictrack.com'"
    ))
    pw = pw_result.scalar_one_or_none()
    if not pw:
        raise HTTPException(404, "Patricia Walker not found.")

    if user.id != pw and user.role != "ops_manager":
        raise HTTPException(403, "Only Patricia or the ops manager can update this schedule.")

    await db.execute(text("""
        INSERT INTO work_schedule_overrides
            (user_id, week_start, regular_day_off, override_day_off, override_reason, set_by)
        VALUES (:uid, :week_start, 2, :override_day, :reason, :set_by)
        ON CONFLICT (user_id, week_start) DO UPDATE
            SET override_day_off = :override_day,
                override_reason  = :reason,
                set_by           = :set_by,
                created_at       = NOW()
    """), {
        "uid":          pw,
        "week_start":   body.week_start,
        "override_day": body.override_day_off,
        "reason":       body.override_reason,
        "set_by":       user.id,
    })
    await db.commit()
    return {"message": "Schedule updated."}
