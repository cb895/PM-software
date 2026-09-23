"""
routers/purchase_orders.py — Purchase order endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from pydantic import BaseModel
from typing import Optional, List
from datetime import date

from core.database import get_db
from core.security import get_current_user, require_po_approver
from services.document_service import dispatch_po_approved

router = APIRouter()


# ---- Schemas ----

class LineItemIn(BaseModel):
    description:        str
    product_id:         Optional[str] = None
    product_url:        Optional[str] = None
    quantity_ordered:   float
    unit:               str = "each"
    unit_cost_estimate: Optional[float] = None
    consumable_id:      Optional[int]   = None
    notes:              Optional[str]   = None


class POCreate(BaseModel):
    project_id:         Optional[int]  = None
    is_overhead:        bool           = False
    supplier_id:        Optional[int]  = None
    supplier_name_free: Optional[str]  = None
    priority:           str = "normal"
    risk_level:         Optional[str]  = None
    urgency:            str = "normal"
    notes:              Optional[str]  = None
    expected_delivery:  Optional[date] = None
    items:              List[LineItemIn]


class RejectIn(BaseModel):
    reason: str


class ReceiptItemIn(BaseModel):
    line_item_id:      int
    quantity_received: float
    notes:             Optional[str] = None


class ReceivePOIn(BaseModel):
    items: List[ReceiptItemIn]


# ---- Helpers ----

PO_SUMMARY_SQL = """
    SELECT
        po.id,
        po.po_number,
        po.status,
        po.priority,
        po.risk_level,
        po.notes,
        po.rejection_reason,
        po.placed_date,
        po.received_date,
        po.expected_delivery,
        po.created_at,
        p.code   AS project_code,
        p.name   AS project_name,
        COALESCE(s.name, po.supplier_name_free) AS supplier_name,
        s.code   AS supplier_code,
        u_req.full_name AS requested_by,
        u_app.full_name AS approved_by,
        u_rec.full_name AS receiver,
        COUNT(li.id)    AS line_item_count,
        SUM(li.quantity_ordered * COALESCE(li.unit_cost_estimate, 0)) AS estimated_total
    FROM purchase_orders po
    LEFT JOIN projects p     ON p.id  = po.project_id
    LEFT JOIN suppliers s    ON s.id  = po.supplier_id
    LEFT JOIN users u_req    ON u_req.id = po.requested_by
    LEFT JOIN users u_app    ON u_app.id = po.approved_by
    LEFT JOIN users u_rec    ON u_rec.id = po.receiver_id
    LEFT JOIN po_line_items li ON li.po_id = po.id
"""


# ---- Endpoints ----

@router.get("")
async def list_purchase_orders(
    status:   Optional[str] = Query(None),
    limit:    int           = Query(100, le=500),
    db:       AsyncSession  = Depends(get_db),
    user      = Depends(get_current_user),
):
    where_clauses = []
    params = {"limit": limit}

    if status:
        where_clauses.append("po.status = :status")
        params["status"] = status

    where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    sql = f"""
        {PO_SUMMARY_SQL}
        {where}
        GROUP BY po.id, p.code, p.name, s.name, s.code,
                 u_req.full_name, u_app.full_name, u_rec.full_name
        ORDER BY po.created_at DESC
        LIMIT :limit
    """
    result = await db.execute(text(sql), params)
    items  = [dict(r) for r in result.mappings()]
    return {"items": items, "total": len(items)}


@router.get("/stats")
async def po_stats(db = Depends(get_db), user = Depends(get_current_user)):
    result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending')     AS pending,
            COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
            COUNT(*) FILTER (WHERE status = 'stuck')       AS stuck,
            COUNT(*) FILTER (WHERE status = 'invoiced')    AS invoiced,
            COUNT(*) FILTER (WHERE status = 'received')    AS received
        FROM purchase_orders
    """))
    return dict(result.mappings().one())


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_purchase_order(
    body: POCreate,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    if not body.supplier_id and not body.supplier_name_free:
        raise HTTPException(400, "Provide a supplier_id or supplier_name_free.")
    if not body.is_overhead and not body.project_id:
        raise HTTPException(400, "Provide a project_id, or set is_overhead=true for overhead purchases.")
    if not body.items:
        raise HTTPException(400, "At least one line item is required.")

    result = await db.execute(text("""
        INSERT INTO purchase_orders
            (project_id, supplier_id, supplier_name_free, requested_by, is_overhead,
             priority, risk_level, urgency, notes, expected_delivery, status)
        VALUES
            (:project_id, :supplier_id, :supplier_name_free, :requested_by, :is_overhead,
             :priority, :risk_level, :urgency, :notes, :expected_delivery, 'pending')
        RETURNING id
    """), {
        "project_id":         body.project_id,
        "is_overhead":        body.is_overhead,
        "supplier_id":        body.supplier_id,
        "supplier_name_free": body.supplier_name_free,
        "requested_by":       user.id,
        "priority":           body.priority,
        "risk_level":         body.risk_level,
        "urgency":            body.urgency,
        "notes":              body.notes,
        "expected_delivery":  body.expected_delivery,
    })
    po_id = result.scalar_one()

    for item in body.items:
        await db.execute(text("""
            INSERT INTO po_line_items
                (po_id, description, product_id, product_url,
                 quantity_ordered, unit, unit_cost_estimate, consumable_id, notes)
            VALUES
                (:po_id, :description, :product_id, :product_url,
                 :quantity_ordered, :unit, :unit_cost_estimate, :consumable_id, :notes)
        """), {
            "po_id":              po_id,
            "description":        item.description,
            "product_id":         item.product_id,
            "product_url":        item.product_url,
            "quantity_ordered":   item.quantity_ordered,
            "unit":               item.unit,
            "unit_cost_estimate": item.unit_cost_estimate,
            "consumable_id":      item.consumable_id,
            "notes":              item.notes,
        })

    # Log status history
    await db.execute(text("""
        INSERT INTO po_status_history (po_id, changed_by, new_status, notes)
        VALUES (:po_id, :user_id, 'pending', 'Request submitted')
    """), {"po_id": po_id, "user_id": user.id})

    await db.commit()
    return {"id": po_id, "message": "Purchase request submitted."}


@router.get("/{po_id}")
async def get_purchase_order(
    po_id: int,
    db    = Depends(get_db),
    user  = Depends(get_current_user),
):
    result = await db.execute(text(f"""
        {PO_SUMMARY_SQL}
        WHERE po.id = :po_id
        GROUP BY po.id, p.code, p.name, s.name, s.code,
                 u_req.full_name, u_app.full_name, u_rec.full_name
    """), {"po_id": po_id})
    po = result.mappings().one_or_none()
    if not po:
        raise HTTPException(404, "Purchase order not found.")

    # Fetch line items, with how much of each has been received so far
    items_result = await db.execute(text("""
        SELECT li.id, li.description, li.product_id, li.product_url,
               li.quantity_ordered, li.unit, li.unit_cost_estimate, li.unit_cost_actual,
               li.consumable_id, li.notes,
               COALESCE(SUM(pr.quantity_received), 0) AS quantity_received
        FROM po_line_items li
        LEFT JOIN po_receipts pr ON pr.line_item_id = li.id
        WHERE li.po_id = :po_id
        GROUP BY li.id
        ORDER BY li.id
    """), {"po_id": po_id})

    receipts_result = await db.execute(text("""
        SELECT pr.id, pr.line_item_id, pr.quantity_received, pr.received_date, pr.notes,
               u.full_name AS received_by
        FROM po_receipts pr
        JOIN users u ON u.id = pr.received_by
        WHERE pr.po_id = :po_id
        ORDER BY pr.received_date DESC, pr.id DESC
    """), {"po_id": po_id})

    return {
        **dict(po),
        "line_items": [dict(r) for r in items_result.mappings()],
        "receipts": [dict(r) for r in receipts_result.mappings()],
    }


@router.post("/{po_id}/approve")
async def approve_po(
    po_id: int,
    db    = Depends(get_db),
    user  = Depends(require_po_approver),
):
    result = await db.execute(text(
        "SELECT status FROM purchase_orders WHERE id = :id"
    ), {"id": po_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Purchase order not found.")
    if row[0] != 'pending':
        raise HTTPException(400, f"Only pending POs can be approved (current status: {row[0]}).")

    # 'approved' is not a po_status value — 'new_order' is the enum member
    # for "approved, not yet sent to supplier" (see 01_schema.sql). PO
    # number is assigned by DB trigger fn_assign_po_number on status →
    # 'new_order'. Format: [SUPPLIER_CODE]-[YYMMDD] using the approval date.
    await db.execute(text("""
        UPDATE purchase_orders
        SET status = 'new_order', approved_by = :user_id,
            updated_at = NOW()
        WHERE id = :po_id AND status = 'pending'
    """), {"po_id": po_id, "user_id": user.id})

    # Fetch the po_number assigned by the trigger
    result = await db.execute(text(
        "SELECT po_number FROM purchase_orders WHERE id = :id"
    ), {"id": po_id})
    po_number = result.scalar_one_or_none() or f"PO-{po_id}"

    await db.execute(text("""
        INSERT INTO po_status_history (po_id, changed_by, old_status, new_status, notes)
        VALUES (:po_id, :user_id, 'pending', 'new_order', 'Approved')
    """), {"po_id": po_id, "user_id": user.id})

    await db.commit()
    dispatch_po_approved(po_id)
    return {"message": "Approved.", "po_number": po_number or f"PO-{po_id}"}


@router.post("/{po_id}/reject")
async def reject_po(
    po_id: int,
    body:  RejectIn,
    db    = Depends(get_db),
    user  = Depends(require_po_approver),
):
    result = await db.execute(text(
        "SELECT status FROM purchase_orders WHERE id = :id"
    ), {"id": po_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Purchase order not found.")
    if row[0] != 'pending':
        raise HTTPException(400, f"Only pending POs can be rejected (current status: {row[0]}).")

    await db.execute(text("""
        UPDATE purchase_orders
        SET status = 'rejected', rejection_reason = :reason, updated_at = NOW()
        WHERE id = :po_id AND status = 'pending'
    """), {"po_id": po_id, "reason": body.reason})

    await db.execute(text("""
        INSERT INTO po_status_history (po_id, changed_by, old_status, new_status, notes)
        VALUES (:po_id, :user_id, 'pending', 'rejected', :reason)
    """), {"po_id": po_id, "user_id": user.id, "reason": body.reason})

    await db.commit()
    return {"message": "Rejected."}


@router.post("/{po_id}/receive")
async def receive_po(
    po_id: int,
    body:  ReceivePOIn,
    db     = Depends(get_db),
    user   = Depends(require_po_approver),
):
    """
    Record a delivery against one or more line items — full or partial.
    Supports multiple receipts over time per line item (e.g. two shipments
    for one ordered quantity). Any line item linked to a consumable
    (po_line_items.consumable_id) restocks that consumable's live stock by
    the quantity actually received. Once every line item on the PO has been
    received in full, the PO itself flips to 'received'.
    """
    po_result = await db.execute(text(
        "SELECT status FROM purchase_orders WHERE id = :id"
    ), {"id": po_id})
    po_row = po_result.mappings().one_or_none()
    if not po_row:
        raise HTTPException(404, "Purchase order not found.")
    if po_row["status"] in ("pending", "rejected", "closed"):
        raise HTTPException(400, f"Cannot record a receipt on a PO with status '{po_row['status']}'.")

    if not body.items:
        raise HTTPException(400, "At least one line item receipt is required.")

    li_result = await db.execute(text("""
        SELECT li.id, li.description, li.quantity_ordered, li.unit, li.consumable_id,
               COALESCE(SUM(pr.quantity_received), 0) AS already_received
        FROM po_line_items li
        LEFT JOIN po_receipts pr ON pr.line_item_id = li.id
        WHERE li.po_id = :po_id
        GROUP BY li.id
    """), {"po_id": po_id})
    line_items = {row["id"]: row for row in li_result.mappings()}

    for item in body.items:
        li = line_items.get(item.line_item_id)
        if not li:
            raise HTTPException(400, f"Line item {item.line_item_id} does not belong to this PO.")
        if item.quantity_received <= 0:
            raise HTTPException(400, "Quantity received must be greater than zero.")
        remaining = float(li["quantity_ordered"]) - float(li["already_received"])
        if item.quantity_received > remaining + 1e-9:
            raise HTTPException(
                400,
                f"'{li['description']}': only {remaining:g} {li['unit']} remaining to receive "
                f"(got {item.quantity_received:g})."
            )

    for item in body.items:
        li = line_items[item.line_item_id]

        await db.execute(text("""
            INSERT INTO po_receipts (po_id, line_item_id, received_by, quantity_received, notes)
            VALUES (:po_id, :line_item_id, :user_id, :qty, :notes)
        """), {
            "po_id": po_id, "line_item_id": item.line_item_id, "user_id": user.id,
            "qty": item.quantity_received, "notes": item.notes,
        })

        if li["consumable_id"]:
            await db.execute(text("""
                UPDATE consumables
                SET current_stock = current_stock + :qty,
                    last_restocked = CURRENT_DATE, updated_at = NOW()
                WHERE id = :cid
            """), {"qty": item.quantity_received, "cid": li["consumable_id"]})

            await db.execute(text("""
                INSERT INTO consumable_transactions
                    (consumable_id, user_id, quantity_change, transaction_type, notes)
                VALUES (:cid, :uid, :qty, 'restock', :notes)
            """), {
                "cid": li["consumable_id"], "uid": user.id, "qty": item.quantity_received,
                "notes": f"Received on PO #{po_id}",
            })

    await db.execute(text("""
        UPDATE purchase_orders
        SET receiver_id = :uid, received_date = CURRENT_DATE, updated_at = NOW()
        WHERE id = :po_id
    """), {"uid": user.id, "po_id": po_id})

    # Per-line-item totals first (a line item with more than one receipt
    # joins to more than one po_receipts row, so summing quantity_ordered
    # across the flat join double-counts it) — then check every item.
    fully_result = await db.execute(text("""
        SELECT bool_and(item_received >= item_ordered - 0.001) AS fully_received
        FROM (
            SELECT li.id, li.quantity_ordered AS item_ordered,
                   COALESCE(SUM(pr.quantity_received), 0) AS item_received
            FROM po_line_items li
            LEFT JOIN po_receipts pr ON pr.line_item_id = li.id
            WHERE li.po_id = :po_id
            GROUP BY li.id, li.quantity_ordered
        ) sub
    """), {"po_id": po_id})
    fully_received = bool(fully_result.scalar_one())

    if fully_received and po_row["status"] != "received":
        await db.execute(text("""
            UPDATE purchase_orders SET status = 'received', updated_at = NOW() WHERE id = :id
        """), {"id": po_id})
        await db.execute(text("""
            INSERT INTO po_status_history (po_id, changed_by, old_status, new_status, notes)
            VALUES (:po_id, :uid, :old, 'received', 'Fully received')
        """), {"po_id": po_id, "uid": user.id, "old": po_row["status"]})

    await db.commit()
    return {"message": "Receipt recorded.", "fully_received": fully_received}


@router.patch("/{po_id}/status")
async def update_po_status(
    po_id:      int,
    new_status: str,
    notes:      Optional[str] = None,
    db          = Depends(get_db),
    user        = Depends(require_po_approver),
):
    valid = ['new_order','emailed','in_progress','stuck','received','invoiced','closed']
    if new_status not in valid:
        raise HTTPException(400, f"Invalid status. Must be one of: {valid}")

    result = await db.execute(text(
        "SELECT status FROM purchase_orders WHERE id = :id"
    ), {"id": po_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Purchase order not found.")
    old_status = row[0]

    await db.execute(text("""
        UPDATE purchase_orders SET status = :status, updated_at = NOW() WHERE id = :id
    """), {"status": new_status, "id": po_id})

    await db.execute(text("""
        INSERT INTO po_status_history (po_id, changed_by, old_status, new_status, notes)
        VALUES (:po_id, :user_id, :old_status, :new_status, :notes)
    """), {"po_id": po_id, "user_id": user.id, "old_status": old_status,
           "new_status": new_status, "notes": notes})

    await db.commit()
    return {"message": "Status updated."}
