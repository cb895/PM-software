"""
services/document_service.py
Orchestrates PDF generation + email dispatch for all document triggers.
Each dispatch creates its own DB session — never passes the request session
to a background thread (async sessions are not thread-safe).
"""
import asyncio
import logging
import threading

log = logging.getLogger(__name__)


def _run_async(coro):
    """Run an async coroutine in a daemon background thread with its own event loop."""
    def run():
        asyncio.run(coro)
    t = threading.Thread(target=run, daemon=True)
    t.start()


async def _get_db():
    """Create a fresh async DB session for background use."""
    from core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        return session


# ============================================================
# 1. Daily Log
# ============================================================
async def _send_daily_log(log_id: int):
    try:
        from sqlalchemy import text
        from core.database import AsyncSessionLocal
        from services.pdf_service import generate_pdf
        from services.email_service import send_email

        async with AsyncSessionLocal() as db:
            result = await db.execute(text("""
                SELECT dl.id, dl.log_date, u.full_name AS employee,
                       COUNT(dle.id) AS projects_worked,
                       COALESCE(SUM(dle.hours_spent), 0) AS total_hours
                FROM daily_logs dl
                JOIN users u ON u.id = dl.user_id
                LEFT JOIN daily_log_entries dle ON dle.log_id = dl.id
                WHERE dl.id = :id
                GROUP BY dl.id, u.full_name
            """), {"id": log_id})
            log_row = result.mappings().one_or_none()
            if not log_row:
                return

            entries_r = await db.execute(text("""
                SELECT dle.id, p.code AS project_code, p.name AS project_name,
                       dle.hours_spent, dle.work_completed, dle.issues_blockers,
                       dle.next_steps, dle.additional_notes
                FROM daily_log_entries dle
                JOIN projects p ON p.id = dle.project_id
                WHERE dle.log_id = :id ORDER BY dle.id
            """), {"id": log_id})
            entries = [dict(r) for r in entries_r.mappings()]

            for entry in entries:
                tasks_r = await db.execute(text("""
                    SELECT t.title AS task_title, dlet.notes, dlet.status_update
                    FROM daily_log_entry_tasks dlet
                    JOIN tasks t ON t.id = dlet.task_id
                    WHERE dlet.log_entry_id = :eid
                """), {"eid": entry["id"]})
                entry["tasks"] = [dict(r) for r in tasks_r.mappings()]

                cons_r = await db.execute(text("""
                    SELECT c.name, c.category, c.unit, cdui.quantity_used, cdui.notes
                    FROM consumable_daily_usage_items cdui
                    JOIN consumables c ON c.id = cdui.consumable_id
                    JOIN consumable_daily_usage cdu ON cdu.id = cdui.usage_id
                    WHERE cdu.log_entry_id = :eid
                """), {"eid": entry["id"]})
                entry["consumables"] = [dict(r) for r in cons_r.mappings()]

        pdf_bytes = generate_pdf("daily_log", {
            "employee":        log_row["employee"],
            "log_date":        log_row["log_date"].strftime("%B %d, %Y"),
            "total_hours":     float(log_row["total_hours"]),
            "projects_worked": log_row["projects_worked"],
            "entries":         entries,
        })
        filename = f"DailyLog_{log_row['employee'].replace(' ','_')}_{log_row['log_date']}.pdf"
        send_email(
            subject   = f"Daily Log — {log_row['employee']} · {log_row['log_date'].strftime('%B %d, %Y')}",
            body_html = f"<p style='font-family:sans-serif'><strong>{log_row['employee']}</strong> submitted their daily log for <strong>{log_row['log_date'].strftime('%B %d, %Y')}</strong>.<br>Total: <strong>{float(log_row['total_hours'])}h</strong>. See attached PDF.</p>",
            attachments=[{"filename": filename, "data": pdf_bytes}],
        )
    except Exception as e:
        log.error(f"Daily log email failed (log_id={log_id}): {e}")


# ============================================================
# 2. Purchase Order Approved
# ============================================================
async def _send_po_approved(po_id: int):
    try:
        from sqlalchemy import text
        from core.database import AsyncSessionLocal
        from services.pdf_service import generate_pdf
        from services.email_service import send_email

        async with AsyncSessionLocal() as db:
            result = await db.execute(text("""
                SELECT po.id, po.po_number, po.priority, po.notes,
                       po.expected_delivery, po.updated_at,
                       p.code AS project_code, p.name AS project_name,
                       COALESCE(s.name, po.supplier_name_free) AS supplier,
                       u_req.full_name AS requested_by,
                       u_app.full_name AS approved_by
                FROM purchase_orders po
                JOIN projects p       ON p.id  = po.project_id
                LEFT JOIN suppliers s ON s.id  = po.supplier_id
                LEFT JOIN users u_req ON u_req.id = po.requested_by
                LEFT JOIN users u_app ON u_app.id = po.approved_by
                WHERE po.id = :id
            """), {"id": po_id})
            po = result.mappings().one_or_none()
            if not po:
                return

            items_r = await db.execute(text("""
                SELECT description, product_id, quantity_ordered, unit, unit_cost_estimate
                FROM po_line_items WHERE po_id = :id ORDER BY id
            """), {"id": po_id})
            line_items = [dict(r) for r in items_r.mappings()]

        estimated_total = sum(
            (i["quantity_ordered"] or 0) * (i["unit_cost_estimate"] or 0) for i in line_items
        )
        pdf_bytes = generate_pdf("purchase_order", {
            "po_number":       po["po_number"] or f"PO-{po_id}",
            "project_code":    po["project_code"],
            "project_name":    po["project_name"],
            "supplier":        po["supplier"],
            "requested_by":    po["requested_by"],
            "approved_by":     po["approved_by"],
            "approved_date":   po["updated_at"].strftime("%B %d, %Y"),
            "priority":        po["priority"],
            "expected_delivery": po["expected_delivery"].strftime("%B %d, %Y") if po["expected_delivery"] else None,
            "notes":           po["notes"],
            "line_items":      line_items,
            "estimated_total": estimated_total,
        })
        filename = f"PO_{(po['po_number'] or str(po_id)).replace('-','_')}.pdf"
        send_email(
            subject   = f"PO Approved — {po['po_number'] or po_id} · {po['supplier']}",
            body_html = f"<p style='font-family:sans-serif'>PO <strong>{po['po_number']}</strong> approved. Supplier: <strong>{po['supplier']}</strong>. Est. total: <strong>${estimated_total:,.2f}</strong>. See attached PDF.</p>",
            attachments=[{"filename": filename, "data": pdf_bytes}],
        )
    except Exception as e:
        log.error(f"PO approval email failed (po_id={po_id}): {e}")


# ============================================================
# 3. Leave Approved
# ============================================================
async def _send_leave_approved(request_id: int):
    try:
        from sqlalchemy import text
        from core.database import AsyncSessionLocal
        from services.pdf_service import generate_pdf
        from services.email_service import send_email

        async with AsyncSessionLocal() as db:
            result = await db.execute(text("""
                SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date,
                       lr.days_requested, lr.review_notes, lr.hr_meeting_required,
                       lr.reviewed_at, u.full_name AS employee,
                       rev.full_name AS approved_by,
                       GREATEST(COALESCE(lb.pto_total,0) - COALESCE(lb.pto_used,0) - COALESCE(lb.pto_pending,0), 0) AS pto_remaining
                FROM leave_requests lr
                JOIN users u          ON u.id   = lr.user_id
                LEFT JOIN users rev   ON rev.id = lr.reviewed_by
                LEFT JOIN leave_balances lb ON lb.user_id = lr.user_id
                    AND lb.year = EXTRACT(YEAR FROM lr.start_date)
                WHERE lr.id = :id
            """), {"id": request_id})
            req = result.mappings().one_or_none()
            if not req:
                return

        pdf_bytes = generate_pdf("leave_approval", {
            "employee":            req["employee"],
            "leave_type":          req["leave_type"],
            "start_date":          req["start_date"].strftime("%B %d, %Y"),
            "end_date":            req["end_date"].strftime("%B %d, %Y"),
            "days_requested":      float(req["days_requested"]),
            "approved_by":         req["approved_by"],
            "approved_date":       req["reviewed_at"].strftime("%B %d, %Y") if req["reviewed_at"] else "Today",
            "review_notes":        req["review_notes"],
            "hr_meeting_required": req["hr_meeting_required"],
            "pto_remaining":       float(req["pto_remaining"] or 0),
        })
        filename = f"LeaveApproval_{req['employee'].replace(' ','_')}_{req['start_date']}.pdf"
        send_email(
            subject   = f"Leave Approved — {req['employee']} · {req['leave_type'].title()} · {req['start_date'].strftime('%b %d')}–{req['end_date'].strftime('%b %d, %Y')}",
            body_html = f"<p style='font-family:sans-serif'><strong>{req['employee']}</strong>'s {req['leave_type']} leave has been <strong style='color:#00773f'>approved</strong>. {req['start_date'].strftime('%B %d')} — {req['end_date'].strftime('%B %d, %Y')} ({float(req['days_requested'])} days). See attached PDF.</p>",
            attachments=[{"filename": filename, "data": pdf_bytes}],
        )
    except Exception as e:
        log.error(f"Leave approval email failed (request_id={request_id}): {e}")


# ============================================================
# 4. New Supplier Added
# ============================================================
async def _send_new_supplier(supplier_id: int, added_by_name: str):
    try:
        from sqlalchemy import text
        from core.database import AsyncSessionLocal
        from services.pdf_service import generate_pdf
        from services.email_service import send_email

        async with AsyncSessionLocal() as db:
            result = await db.execute(text("""
                SELECT s.id, s.name, s.code, s.supplier_type, s.onboarding_status,
                       s.contact_name, s.email, s.phone, s.website, s.notes, s.created_at,
                       STRING_AGG(sc.category, ', ' ORDER BY sc.category) AS categories
                FROM suppliers s
                LEFT JOIN supplier_categories sc ON sc.supplier_id = s.id
                WHERE s.id = :id GROUP BY s.id
            """), {"id": supplier_id})
            sup = result.mappings().one_or_none()
            if not sup:
                return

        pdf_bytes = generate_pdf("new_supplier", {
            "name":              sup["name"],
            "code":              sup["code"],
            "supplier_type":     sup["supplier_type"],
            "onboarding_status": sup["onboarding_status"],
            "contact_name":      sup["contact_name"],
            "email":             sup["email"],
            "phone":             sup["phone"],
            "website":           sup["website"],
            "categories":        sup["categories"],
            "notes":             sup["notes"],
            "added_by":          added_by_name,
            "added_date":        sup["created_at"].strftime("%B %d, %Y") if sup["created_at"] else "Today",
        })
        filename = f"NewSupplier_{sup['name'].replace(' ','_')}.pdf"
        send_email(
            subject   = f"New Supplier Added — {sup['name']}",
            body_html = f"<p style='font-family:sans-serif'>New supplier <strong>{sup['name']}</strong> added by <strong>{added_by_name}</strong>. See attached PDF for full details.</p>",
            attachments=[{"filename": filename, "data": pdf_bytes}],
        )
    except Exception as e:
        log.error(f"New supplier email failed (supplier_id={supplier_id}): {e}")


# ============================================================
# 5. Weekly Report Published
# ============================================================
async def _send_weekly_report(report_id: int):
    try:
        from sqlalchemy import text
        from core.database import AsyncSessionLocal
        from services.pdf_service import generate_pdf
        from services.email_service import send_email

        async with AsyncSessionLocal() as db:
            result = await db.execute(text("""
                SELECT wr.id, wr.week_start, wr.week_end, wr.executive_summary,
                       wr.published_at, u.full_name AS published_by
                FROM weekly_reports wr
                LEFT JOIN users u ON u.id = wr.published_by
                WHERE wr.id = :id
            """), {"id": report_id})
            report = result.mappings().one_or_none()
            if not report:
                return

            sections_r = await db.execute(text("""
                SELECT wrs.*, p.code AS project_code, p.name AS project_name
                FROM weekly_report_sections wrs
                JOIN projects p ON p.id = wrs.project_id
                WHERE wrs.report_id = :id ORDER BY wrs.sort_order
            """), {"id": report_id})
            sections = [dict(r) for r in sections_r.mappings()]

        for s in sections:
            alloc = s.get("budget_allocated") or 0
            s["pct_spent"] = (s.get("budget_spent_total", 0) / alloc * 100) if alloc > 0 else 0

        pdf_bytes = generate_pdf("weekly_report", {
            "week_start":        report["week_start"].strftime("%B %d, %Y"),
            "week_end":          report["week_end"].strftime("%B %d, %Y"),
            "executive_summary": report["executive_summary"],
            "sections":          sections,
        })
        week_label = f"{report['week_start'].strftime('%b %d')}–{report['week_end'].strftime('%b %d, %Y')}"
        filename = f"WeeklyReport_{report['week_start']}.pdf"
        send_email(
            subject   = f"Weekly Report Published — {week_label}",
            body_html = f"<p style='font-family:sans-serif'>Weekly report for <strong>{week_label}</strong> published by <strong>{report['published_by']}</strong>. See attached PDF.</p>",
            attachments=[{"filename": filename, "data": pdf_bytes}],
        )
    except Exception as e:
        log.error(f"Weekly report email failed (report_id={report_id}): {e}")


# ============================================================
# Public fire-and-forget wrappers — call from routers
# ============================================================
def dispatch_daily_log(log_id: int):
    _run_async(_send_daily_log(log_id))

def dispatch_po_approved(po_id: int):
    _run_async(_send_po_approved(po_id))

def dispatch_leave_approved(request_id: int):
    _run_async(_send_leave_approved(request_id))

def dispatch_new_supplier(supplier_id: int, added_by_name: str):
    _run_async(_send_new_supplier(supplier_id, added_by_name))

def dispatch_weekly_report(report_id: int):
    _run_async(_send_weekly_report(report_id))
