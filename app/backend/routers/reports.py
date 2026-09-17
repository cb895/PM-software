"""routers/reports.py — Weekly report endpoints"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel
from core.database import get_db
from core.security import require_roles, get_current_user, require_report_manager
from services.document_service import dispatch_weekly_report

router = APIRouter()

# ---- Schemas ----

class ReportPatch(BaseModel):
    executive_summary: Optional[str] = None

class SectionPatch(BaseModel):
    ops_notes: Optional[str] = None

# ---- Endpoints ----

@router.get("")
async def list_reports(
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT id, week_start, week_end, status,
               generated_at, published_at,
               executive_summary, file_path
        FROM weekly_reports
        ORDER BY week_start DESC
        LIMIT 52
    """))
    return [dict(r) for r in result.mappings()]


@router.post("/generate", status_code=status.HTTP_201_CREATED)
async def generate_report(
    db   = Depends(get_db),
    user = Depends(require_report_manager),
):
    result = await db.execute(text("SELECT fn_generate_weekly_report()"))
    report_id = result.scalar_one()
    await db.commit()
    return {"message": "Weekly report draft generated.", "report_id": report_id}


@router.get("/{report_id}")
async def get_report(
    report_id: int,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    # Main report record
    result = await db.execute(text("""
        SELECT wr.id, wr.week_start, wr.week_end, wr.status,
               wr.generated_at, wr.published_at,
               wr.executive_summary, wr.file_path,
               u_gen.full_name AS generated_by_name,
               u_pub.full_name AS published_by_name
        FROM weekly_reports wr
        LEFT JOIN users u_gen ON u_gen.id = wr.generated_by
        LEFT JOIN users u_pub ON u_pub.id = wr.published_by
        WHERE wr.id = :id
    """), {"id": report_id})
    report = result.mappings().one_or_none()
    if not report:
        raise HTTPException(404, "Report not found.")

    # Per-project sections
    sections_result = await db.execute(text("""
        SELECT wrs.*, p.code AS project_code, p.name AS project_name
        FROM weekly_report_sections wrs
        JOIN projects p ON p.id = wrs.project_id
        WHERE wrs.report_id = :id
        ORDER BY wrs.sort_order, p.name
    """), {"id": report_id})
    sections = [dict(r) for r in sections_result.mappings()]

    return {**dict(report), "sections": sections}


@router.patch("/{report_id}")
async def update_report(
    report_id: int,
    body: ReportPatch,
    db   = Depends(get_db),
    user = Depends(require_report_manager),
):
    # Only allow editing drafts
    result = await db.execute(text(
        "SELECT status FROM weekly_reports WHERE id = :id"
    ), {"id": report_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Report not found.")
    if row[0] != 'draft':
        raise HTTPException(400, "Only draft reports can be edited.")

    await db.execute(text("""
        UPDATE weekly_reports
        SET executive_summary = :summary
        WHERE id = :id
    """), {"summary": body.executive_summary, "id": report_id})
    await db.commit()
    return {"message": "Report updated."}


@router.patch("/{report_id}/sections/{section_id}")
async def update_section(
    report_id:  int,
    section_id: int,
    body: SectionPatch,
    db   = Depends(get_db),
    user = Depends(require_report_manager),
):
    await db.execute(text("""
        UPDATE weekly_report_sections
        SET ops_notes = :notes
        WHERE id = :id AND report_id = :report_id
    """), {"notes": body.ops_notes, "id": section_id, "report_id": report_id})
    await db.commit()
    return {"message": "Section notes saved."}


@router.post("/{report_id}/publish")
async def publish_report(
    report_id: int,
    db   = Depends(get_db),
    user = Depends(require_report_manager),
):
    # Verify draft status
    result = await db.execute(text(
        "SELECT status FROM weekly_reports WHERE id = :id"
    ), {"id": report_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Report not found.")
    if row[0] != 'draft':
        raise HTTPException(400, "Only draft reports can be published.")

    # Publish
    await db.execute(text("""
        UPDATE weekly_reports
        SET status       = 'published',
            published_by = :user_id,
            published_at = NOW()
        WHERE id = :id
    """), {"user_id": user.id, "id": report_id})

    # Notify CEO and ops manager
    await db.execute(text("""
        INSERT INTO notifications
            (recipient_id, notification_type, title, message, reference_id, reference_type)
        SELECT
            u.id,
            'weekly_report',
            'Weekly report published',
            'The weekly report has been published and is ready for review.',
            :report_id,
            'weekly_report'
        FROM users u
        WHERE u.role IN ('ceo', 'ops_manager') AND u.is_active = TRUE
    """), {"report_id": report_id})

    # Archive the previous published report if any
    await db.execute(text("""
        UPDATE weekly_reports
        SET status = 'archived'
        WHERE status = 'published' AND id != :id
    """), {"id": report_id})

    await db.commit()
    dispatch_weekly_report(report_id)
    return {"message": "Report published."}
