"""routers/daily_logs.py — Daily log endpoints"""
from fastapi import APIRouter, Depends, Query, HTTPException
from services.document_service import dispatch_daily_log
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from datetime import date
from pydantic import BaseModel
from typing import List
from core.database import get_db
from core.security import get_current_user, require_roles

router = APIRouter()

class UsageItem(BaseModel):
    consumable_id: int
    quantity_used: float
    notes: Optional[str] = None

class LogEntryIn(BaseModel):
    project_id:      int
    hours_spent:     float
    hourly_rate:     Optional[float] = None
    work_completed:  Optional[str]   = None
    issues_blockers: Optional[str]   = None
    next_steps:      Optional[str]   = None
    additional_notes:Optional[str]   = None
    task_updates:    Optional[List[dict]] = []
    consumables:     Optional[List[UsageItem]] = []

@router.get("")
async def list_logs(
    log_date:   Optional[date] = Query(None),
    project_id: Optional[int]  = Query(None),
    user_id:    Optional[int]  = Query(None),
    week_start: Optional[str]  = Query(None),
    week_end:   Optional[str]  = Query(None),
    db = Depends(get_db), user = Depends(get_current_user)
):
    params = {}
    where  = ["dl.submitted_at IS NOT NULL"]

    if log_date:
        where.append("dl.log_date = :log_date")
        params["log_date"] = log_date

    if user_id:
        where.append("dl.user_id = :filter_user_id")
        params["filter_user_id"] = user_id

    if project_id:
        where.append("EXISTS (SELECT 1 FROM daily_log_entries dle2 WHERE dle2.log_id = dl.id AND dle2.project_id = :project_id)")
        params["project_id"] = project_id

    if week_start:
        where.append("dl.log_date >= :week_start")
        params["week_start"] = week_start

    if week_end:
        where.append("dl.log_date <= :week_end")
        params["week_end"] = week_end

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    result = await db.execute(text(f"""
        SELECT dl.id, dl.log_date, dl.submitted_at,
               u.full_name AS employee, u.id AS user_id,
               COUNT(DISTINCT dle.id) AS project_count,
               COALESCE(SUM(dle.hours_spent), 0) AS total_hours
        FROM daily_logs dl
        JOIN users u ON u.id = dl.user_id
        LEFT JOIN daily_log_entries dle ON dle.log_id = dl.id
        {where_sql}
        GROUP BY dl.id, u.full_name, u.id
        ORDER BY dl.log_date DESC
        LIMIT 200
    """), params)
    return [dict(r) for r in result.mappings()]

@router.get("/missing")
async def missing_logs(db = Depends(get_db), user = Depends(require_roles("ops_manager", "ceo"))):
    result = await db.execute(text("""
        SELECT u.id, u.full_name, mlf.missing_date
        FROM missing_log_flags mlf
        JOIN users u ON u.id = mlf.user_id
        WHERE mlf.resolved = FALSE AND mlf.missing_date = CURRENT_DATE - 1
        ORDER BY u.full_name
    """))
    return [dict(r) for r in result.mappings()]

@router.post("/today/entries")
async def add_log_entry(body: LogEntryIn, db = Depends(get_db), user = Depends(get_current_user)):
    # Get or create today's log
    result = await db.execute(text("""
        INSERT INTO daily_logs (user_id, log_date)
        VALUES (:user_id, CURRENT_DATE)
        ON CONFLICT (user_id, log_date) DO UPDATE SET updated_at = NOW()
        RETURNING id
    """), {"user_id": user.id})
    log_id = result.scalar_one()

    # Insert project entry
    result = await db.execute(text("""
        INSERT INTO daily_log_entries
            (log_id, project_id, hours_spent, hourly_rate,
             work_completed, issues_blockers, next_steps, additional_notes)
        VALUES (:log_id, :project_id, :hours_spent, :hourly_rate,
                :work_completed, :issues_blockers, :next_steps, :additional_notes)
        ON CONFLICT (log_id, project_id) DO UPDATE SET
            hours_spent = EXCLUDED.hours_spent,
            work_completed = EXCLUDED.work_completed,
            issues_blockers = EXCLUDED.issues_blockers,
            next_steps = EXCLUDED.next_steps,
            additional_notes = EXCLUDED.additional_notes
        RETURNING id
    """), {
        "log_id": log_id, "project_id": body.project_id,
        "hours_spent": body.hours_spent, "hourly_rate": body.hourly_rate,
        "work_completed": body.work_completed, "issues_blockers": body.issues_blockers,
        "next_steps": body.next_steps, "additional_notes": body.additional_notes,
    })
    entry_id = result.scalar_one()

    # Replace this entry's consumable-usage set with what was just submitted.
    # A draft entry can be saved more than once before final submit, so this
    # reconciles to "current state" rather than accumulating duplicates —
    # delete any previously-posted budget entries for the old item set before
    # the old items themselves are removed (budget_entries.reference_id isn't
    # a real FK, so it won't cascade). Live stock is NOT touched here; it's
    # only ever decremented once, at final submit (see submit_today_log).
    existing_usage = await db.execute(text(
        "SELECT id FROM consumable_daily_usage WHERE log_entry_id = :eid"
    ), {"eid": entry_id})
    existing_usage_id = existing_usage.scalar_one_or_none()
    if existing_usage_id is not None:
        await db.execute(text("""
            DELETE FROM budget_entries
            WHERE reference_type = 'consumable_daily_usage_item'
              AND reference_id IN (
                  SELECT id FROM consumable_daily_usage_items WHERE usage_id = :uid
              )
        """), {"uid": existing_usage_id})

    if body.consumables:
        usage_result = await db.execute(text("""
            INSERT INTO consumable_daily_usage (log_entry_id, user_id, project_id)
            VALUES (:eid, :user_id, :project_id)
            ON CONFLICT (log_entry_id) DO UPDATE SET project_id = EXCLUDED.project_id
            RETURNING id
        """), {"eid": entry_id, "user_id": user.id, "project_id": body.project_id})
        usage_id = usage_result.scalar_one()

        await db.execute(text(
            "DELETE FROM consumable_daily_usage_items WHERE usage_id = :uid"
        ), {"uid": usage_id})

        for item in body.consumables:
            await db.execute(text("""
                INSERT INTO consumable_daily_usage_items (usage_id, consumable_id, quantity_used, notes)
                VALUES (:uid, :cid, :qty, :notes)
            """), {
                "uid": usage_id, "cid": item.consumable_id,
                "qty": item.quantity_used, "notes": item.notes,
            })
    elif existing_usage_id is not None:
        # No consumables on this save — clear out a previously-saved set.
        await db.execute(text(
            "DELETE FROM consumable_daily_usage WHERE id = :uid"
        ), {"uid": existing_usage_id})  # cascades to consumable_daily_usage_items

    # Replace this entry's linked-task set the same way — reconciled to the
    # latest draft, not accumulated. Applying a status_update to the actual
    # task (and recording task_history) happens once at final submit, same
    # reasoning as stock: repeated draft saves shouldn't flip a task's real
    # status back and forth or write a history entry per keystroke.
    await db.execute(text(
        "DELETE FROM daily_log_entry_tasks WHERE log_entry_id = :eid"
    ), {"eid": entry_id})

    for t in (body.task_updates or []):
        task_id = t.get("task_id")
        if not task_id:
            continue
        owner = await db.execute(text(
            "SELECT project_id FROM tasks WHERE id = :tid"
        ), {"tid": task_id})
        row = owner.one_or_none()
        if not row:
            raise HTTPException(404, f"Task {task_id} not found.")
        if row[0] != body.project_id:
            raise HTTPException(400, f"Task {task_id} does not belong to this entry's project.")

        await db.execute(text("""
            INSERT INTO daily_log_entry_tasks (log_entry_id, task_id, notes, status_update)
            VALUES (:eid, :tid, :notes, :status_update)
        """), {
            "eid": entry_id, "tid": task_id,
            "notes": t.get("notes"), "status_update": t.get("status_update"),
        })

    await db.commit()
    dispatch_daily_log(log_id)
    return {"log_id": log_id, "entry_id": entry_id}

@router.get("/today")
async def get_today_log(db = Depends(get_db), user = Depends(get_current_user)):
    result = await db.execute(text("""
        SELECT dl.id, dl.log_date, dl.submitted_at,
               COALESCE(SUM(dle.hours_spent), 0) AS total_hours,
               COUNT(dle.id) AS projects_worked
        FROM daily_logs dl
        LEFT JOIN daily_log_entries dle ON dle.log_id = dl.id
        WHERE dl.user_id = :uid AND dl.log_date = CURRENT_DATE
        GROUP BY dl.id
    """), {"uid": user.id})
    row = result.mappings().one_or_none()
    return dict(row) if row else None

@router.post("/today/submit")
async def submit_today_log(db = Depends(get_db), user = Depends(get_current_user)):
    result = await db.execute(text("""
        UPDATE daily_logs SET submitted_at = NOW(), updated_at = NOW()
        WHERE user_id = :uid AND log_date = CURRENT_DATE AND submitted_at IS NULL
        RETURNING id
    """), {"uid": user.id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(400, "No draft log found for today or already submitted.")
    log_id = row[0]

    # Live stock is decremented exactly once, here at final submit — not on
    # every draft save — using whatever consumable usage is currently on
    # file for this log's entries (see add_log_entry, which keeps that set
    # reconciled to the latest draft state).
    usage_result = await db.execute(text("""
        SELECT cdui.id AS item_id, cdui.consumable_id, cdui.quantity_used,
               cdu.project_id, c.name, c.current_stock, c.unit
        FROM consumable_daily_usage cdu
        JOIN consumable_daily_usage_items cdui ON cdui.usage_id = cdu.id
        JOIN consumables c ON c.id = cdui.consumable_id
        WHERE cdu.log_entry_id IN (
            SELECT id FROM daily_log_entries WHERE log_id = :log_id
        )
    """), {"log_id": log_id})
    usage_items = list(usage_result.mappings())

    # Combine quantities per consumable (the same item can appear on more
    # than one project entry in the same log) and check sufficiency up front
    # so a shortfall on one item doesn't leave others partially applied.
    totals = {}
    for it in usage_items:
        totals.setdefault(it["consumable_id"], {"name": it["name"], "unit": it["unit"],
                                                  "current_stock": it["current_stock"], "needed": 0.0})
        totals[it["consumable_id"]]["needed"] += float(it["quantity_used"])

    shortfalls = [
        f"{v['name']} (need {v['needed']}, have {v['current_stock']} {v['unit']})"
        for v in totals.values() if v["needed"] > float(v["current_stock"])
    ]
    if shortfalls:
        raise HTTPException(400, "Insufficient stock to submit this log: " + "; ".join(shortfalls))

    for it in usage_items:
        await db.execute(text("""
            UPDATE consumables
            SET current_stock = current_stock - :qty, updated_at = NOW()
            WHERE id = :cid
        """), {"qty": it["quantity_used"], "cid": it["consumable_id"]})

        await db.execute(text("""
            INSERT INTO consumable_transactions
                (consumable_id, user_id, project_id, quantity_change, transaction_type, notes)
            VALUES (:cid, :uid, :pid, :change, 'usage', :notes)
        """), {
            "cid": it["consumable_id"], "uid": user.id, "pid": it["project_id"],
            "change": -float(it["quantity_used"]),
            "notes": f"Logged via daily log #{log_id}",
        })

    # Note: task status_update is NOT applied here. A DB trigger
    # (trg_log_entry_task_status / fn_log_entry_task_status_update in
    # 01_schema.sql) already applies it — and writes task_history —
    # the moment a daily_log_entry_tasks row is inserted in add_log_entry,
    # i.e. as soon as the draft is saved, not deferred to submit. That's
    # a deliberate difference from stock: a task's status is just its
    # current value, so re-applying the same status on a re-save is
    # harmless (if a little noisy in task_history), unlike stock where
    # re-decrementing on every draft edit would double-count usage.

    await db.commit()
    return {"message": "Log submitted.", "log_id": log_id}

@router.get("/{log_id}")
async def get_log_detail(log_id: int, db = Depends(get_db), user = Depends(get_current_user)):
    result = await db.execute(text("""
        SELECT dl.id AS log_id, dl.log_date, dl.submitted_at,
               u.full_name AS employee, u.id AS user_id,
               COUNT(dle.id) AS projects_worked,
               COALESCE(SUM(dle.hours_spent), 0) AS total_hours
        FROM daily_logs dl
        JOIN users u ON u.id = dl.user_id
        LEFT JOIN daily_log_entries dle ON dle.log_id = dl.id
        WHERE dl.id = :lid
        GROUP BY dl.id, u.full_name, u.id
    """), {"lid": log_id})
    log = result.mappings().one_or_none()
    if not log:
        from fastapi import HTTPException
        raise HTTPException(404, "Log not found.")

    entries_result = await db.execute(text("""
        SELECT dle.id, p.code AS project_code, p.name AS project_name,
               dle.hours_spent, dle.work_completed, dle.issues_blockers,
               dle.next_steps, dle.additional_notes
        FROM daily_log_entries dle
        JOIN projects p ON p.id = dle.project_id
        WHERE dle.log_id = :lid ORDER BY dle.id
    """), {"lid": log_id})
    entries = [dict(r) for r in entries_result.mappings()]

    for entry in entries:
        tasks_r = await db.execute(text("""
            SELECT dlet.task_id, t.title AS task_title, dlet.notes, dlet.status_update
            FROM daily_log_entry_tasks dlet
            JOIN tasks t ON t.id = dlet.task_id
            WHERE dlet.log_entry_id = :eid
        """), {"eid": entry["id"]})
        entry["tasks"] = [dict(r) for r in tasks_r.mappings()]

        cons_r = await db.execute(text("""
            SELECT cdui.consumable_id, c.name, c.category, c.unit,
                   cdui.quantity_used, cdui.notes
            FROM consumable_daily_usage_items cdui
            JOIN consumables c ON c.id = cdui.consumable_id
            JOIN consumable_daily_usage cdu ON cdu.id = cdui.usage_id
            WHERE cdu.log_entry_id = :eid
        """), {"eid": entry["id"]})
        entry["consumables"] = [dict(r) for r in cons_r.mappings()]

    return {**dict(log), "entries": entries}


# ---- Delay detection ---- 

async def analyse_log_for_delays(entry_id: int, task_updates: list, issues_text: str, db) -> list:
    """Call Claude API to detect delay signals in a log entry. Returns list of proposals."""
    if not issues_text or not task_updates:
        return []

    import httpx, os, json

    # Build task context
    task_context = []
    for t in task_updates:
        result = await db.execute(text("""
            SELECT t.id, t.title, t.planned_end, t.status
            FROM tasks t WHERE t.id = :tid
        """), {"tid": t.get("task_id")})
        row = result.mappings().one_or_none()
        if row:
            task_context.append(dict(row))

    if not task_context:
        return []

    prompt = f"""You are analysing a lab technician's daily log entry to detect potential project delays.

Issues / blockers reported:
"{issues_text}"

Tasks linked to this log entry:
{json.dumps(task_context, default=str, indent=2)}

Analyse the issues text and for each task that may be delayed, return a JSON array of delay proposals.
Each proposal must have:
- task_id (integer)
- estimated_delay_days (integer, 0 if no delay detected)
- confidence (one of: "low", "medium", "high")
- reason (1-2 sentence plain English explanation of what caused the delay and how you estimated it)

Only include tasks where estimated_delay_days > 0.
If no delays are detected, return an empty array [].
Return ONLY valid JSON, no other text."""

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key":         os.environ.get("ANTHROPIC_API_KEY", ""),
                    "anthropic-version": "2023-06-01",
                    "content-type":      "application/json",
                },
                json={
                    "model":      "claude-sonnet-4-6",
                    "max_tokens": 500,
                    "messages":   [{"role": "user", "content": prompt}],
                }
            )
        if resp.status_code != 200:
            return []
        data = resp.json()
        raw = data["content"][0]["text"].strip()
        proposals = json.loads(raw)
        return proposals if isinstance(proposals, list) else []
    except Exception:
        return []


@router.post("/today/entries/analyse-delays")
async def analyse_entry_delays(
    body: LogEntryIn,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """Analyse a submitted log entry for delay signals and create pending proposals."""
    if not body.issues_blockers:
        return {"proposals": []}

    proposals = await analyse_log_for_delays(
        entry_id=0,
        task_updates=body.task_updates or [],
        issues_text=body.issues_blockers,
        db=db,
    )

    created = []
    for p in proposals:
        task_id = p.get("task_id")
        delay   = p.get("estimated_delay_days", 0)
        if not task_id or delay <= 0:
            continue

        # Get current planned_end
        result = await db.execute(text(
            "SELECT planned_end FROM tasks WHERE id = :id"
        ), {"id": task_id})
        row = result.one_or_none()
        if not row or not row[0]:
            continue

        from datetime import timedelta
        original_end = row[0]
        proposed_end = original_end + timedelta(days=delay)

        ins = await db.execute(text("""
            INSERT INTO task_delay_proposals
                (task_id, proposed_by, detected_from, estimated_delay_days,
                 confidence, reason, original_end, proposed_end, status)
            VALUES
                (:task_id, :proposed_by, :detected_from, :delay,
                 :confidence, :reason, :original_end, :proposed_end, 'pending')
            RETURNING id
        """), {
            "task_id":      task_id,
            "proposed_by":  user.id,
            "detected_from":body.issues_blockers[:500],
            "delay":        delay,
            "confidence":   p.get("confidence", "medium"),
            "reason":       p.get("reason", ""),
            "original_end": original_end,
            "proposed_end": proposed_end,
        })
        proposal_id = ins.scalar_one()
        created.append({
            "id":           proposal_id,
            "task_id":      task_id,
            "delay_days":   delay,
            "confidence":   p.get("confidence"),
            "reason":       p.get("reason"),
            "original_end": str(original_end),
            "proposed_end": str(proposed_end),
        })

    await db.commit()
    return {"proposals": created}
