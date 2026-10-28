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

BUDGET_TREATMENTS = ('overhead', 'project_cost', 'consumable_usage')


# ---- Schemas ----

class LineItemIn(BaseModel):
    description:        str
    product_id:         Optional[str] = None
    product_url:        Optional[str] = None
    quantity_ordered:   float
    unit:               str = "each"
    unit_cost_estimate: Optional[float] = None
    consumable_id:      Optional[int]   = None
    budget_treatment:   Optional[str]   = None  # overhead | project_cost | consumable_usage; defaulted if omitted
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
    placed_date:        Optional[date] = None
    items:              List[LineItemIn]


class PlacedDateIn(BaseModel):
    placed_date: date


class RejectIn(BaseModel):
    reason: str


class ReceiptItemIn(BaseModel):
    line_item_id:       int
    quantity_received:  float
    unit_cost_actual:   Optional[float] = None  # confirms/corrects the cost posted to budget for this receipt
    notes:              Optional[str] = None


class ReceivePOIn(BaseModel):
    items: List[ReceiptItemIn]


class LineItemUpdate(BaseModel):
    quantity_ordered: float


class BudgetTreatmentUpdate(BaseModel):
    budget_treatment: str


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
        po.requested_by AS requested_by_id,
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
    for item in body.items:
        if item.budget_treatment and item.budget_treatment not in BUDGET_TREATMENTS:
            raise HTTPException(400, f"Invalid budget_treatment. Must be one of: {BUDGET_TREATMENTS}")

    result = await db.execute(text("""
        INSERT INTO purchase_orders
            (project_id, supplier_id, supplier_name_free, requested_by, is_overhead,
             priority, risk_level, urgency, notes, expected_delivery, placed_date, status)
        VALUES
            (:project_id, :supplier_id, :supplier_name_free, :requested_by, :is_overhead,
             :priority, :risk_level, :urgency, :notes, :expected_delivery,
             COALESCE(:placed_date, CURRENT_DATE), 'pending')
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
        "placed_date":        body.placed_date,
    })
    po_id = result.scalar_one()

    for item in body.items:
        # Default treatment when not given explicitly: items tracked as
        # inventory are consumed over time; items on an overhead PO default
        # to overhead; everything else charges the project directly.
        budget_treatment = item.budget_treatment
        if not budget_treatment:
            if item.consumable_id:
                budget_treatment = 'consumable_usage'
            elif body.is_overhead:
                budget_treatment = 'overhead'
            else:
                budget_treatment = 'project_cost'

        await db.execute(text("""
            INSERT INTO po_line_items
                (po_id, description, product_id, product_url,
                 quantity_ordered, unit, unit_cost_estimate, consumable_id,
                 budget_treatment, notes)
            VALUES
                (:po_id, :description, :product_id, :product_url,
                 :quantity_ordered, :unit, :unit_cost_estimate, :consumable_id,
                 :budget_treatment, :notes)
        """), {
            "po_id":              po_id,
            "description":        item.description,
            "product_id":         item.product_id,
            "product_url":        item.product_url,
            "quantity_ordered":   item.quantity_ordered,
            "unit":               item.unit,
            "unit_cost_estimate": item.unit_cost_estimate,
            "consumable_id":      item.consumable_id,
            "budget_treatment":   budget_treatment,
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
               li.consumable_id, li.budget_treatment, li.notes,
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


@router.patch("/{po_id}/items/{line_item_id}")
async def update_line_item_quantity(
    po_id: int,
    line_item_id: int,
    body: LineItemUpdate,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """
    Correct a line item's quantity while the request is still pending —
    e.g. the requester or an approver catches a typo before it's approved.
    Once a PO leaves 'pending' (approved, rejected, or any later status)
    its line items are locked; they're the record of what was actually
    ordered/received by that point.
    """
    po_result = await db.execute(text(
        "SELECT status, requested_by FROM purchase_orders WHERE id = :id"
    ), {"id": po_id})
    po_row = po_result.mappings().one_or_none()
    if not po_row:
        raise HTTPException(404, "Purchase order not found.")

    if po_row["status"] != "pending":
        raise HTTPException(400, "Line items can only be edited while the request is pending approval.")

    if user.id != po_row["requested_by"] and user.role not in ("ops_manager", "ceo", "qm_director"):
        raise HTTPException(403, "Only the requester or an approver can edit this request's line items.")

    if body.quantity_ordered <= 0:
        raise HTTPException(400, "Quantity must be greater than zero.")

    result = await db.execute(text("""
        UPDATE po_line_items SET quantity_ordered = :qty
        WHERE id = :line_item_id AND po_id = :po_id
        RETURNING id
    """), {"qty": body.quantity_ordered, "line_item_id": line_item_id, "po_id": po_id})
    if not result.one_or_none():
        raise HTTPException(404, "Line item not found on this purchase order.")

    await db.commit()
    return {"message": "Quantity updated."}


@router.patch("/{po_id}/items/{line_item_id}/budget-treatment")
async def update_line_item_budget_treatment(
    po_id: int,
    line_item_id: int,
    body: BudgetTreatmentUpdate,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """
    Change how a line item posts to the budget once received. Locked once
    any quantity has actually been received against that item — at that
    point the budget entry (or deliberate absence of one) already reflects
    the prior treatment.
    """
    if body.budget_treatment not in BUDGET_TREATMENTS:
        raise HTTPException(400, f"Invalid budget_treatment. Must be one of: {BUDGET_TREATMENTS}")

    po_result = await db.execute(text(
        "SELECT requested_by FROM purchase_orders WHERE id = :id"
    ), {"id": po_id})
    po_row = po_result.mappings().one_or_none()
    if not po_row:
        raise HTTPException(404, "Purchase order not found.")

    if user.id != po_row["requested_by"] and user.role not in ("ops_manager", "ceo", "qm_director"):
        raise HTTPException(403, "Only the requester or an approver can edit this request's line items.")

    li_result = await db.execute(text("""
        SELECT li.id, COALESCE(SUM(pr.quantity_received), 0) AS already_received
        FROM po_line_items li
        LEFT JOIN po_receipts pr ON pr.line_item_id = li.id
        WHERE li.id = :line_item_id AND li.po_id = :po_id
        GROUP BY li.id
    """), {"line_item_id": line_item_id, "po_id": po_id})
    li_row = li_result.mappings().one_or_none()
    if not li_row:
        raise HTTPException(404, "Line item not found on this purchase order.")
    if float(li_row["already_received"]) > 0:
        raise HTTPException(400, "Can't change budget treatment after this item has been received.")

    await db.execute(text("""
        UPDATE po_line_items SET budget_treatment = :bt WHERE id = :line_item_id
    """), {"bt": body.budget_treatment, "line_item_id": line_item_id})

    await db.commit()
    return {"message": "Budget treatment updated."}


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
        "SELECT status, project_id, is_overhead, po_number FROM purchase_orders WHERE id = :id"
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
               li.unit_cost_estimate, li.unit_cost_actual, li.budget_treatment,
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

        receipt_result = await db.execute(text("""
            INSERT INTO po_receipts (po_id, line_item_id, received_by, quantity_received, notes)
            VALUES (:po_id, :line_item_id, :user_id, :qty, :notes)
            RETURNING id
        """), {
            "po_id": po_id, "line_item_id": item.line_item_id, "user_id": user.id,
            "qty": item.quantity_received, "notes": item.notes,
        })
        receipt_id = receipt_result.scalar_one()

        if item.unit_cost_actual is not None:
            await db.execute(text("""
                UPDATE po_line_items SET unit_cost_actual = :cost WHERE id = :lid
            """), {"cost": item.unit_cost_actual, "lid": item.line_item_id})

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

        # Post to budget per this item's treatment — skipped entirely for
        # consumable_usage items, whose cost is tracked as stock is consumed
        # (see fn_post_consumable_budget), not at receipt.
        treatment = li["budget_treatment"] or "project_cost"
        if treatment != "consumable_usage":
            unit_cost = item.unit_cost_actual
            if unit_cost is None:
                unit_cost = li["unit_cost_actual"]
            if unit_cost is None:
                unit_cost = li["unit_cost_estimate"]

            if unit_cost:
                amount = round(float(item.quantity_received) * float(unit_cost), 2)
                # A PO already flagged overhead has no project to charge even
                # if an item was left as project_cost.
                is_overhead_entry = treatment == "overhead" or po_row["project_id"] is None
                entry_project_id  = None if is_overhead_entry else po_row["project_id"]

                phase_id = None
                if entry_project_id is not None:
                    phase_result = await db.execute(text("""
                        SELECT id FROM project_phases
                        WHERE project_id = :pid AND is_active = TRUE
                          AND (start_date IS NULL OR start_date <= CURRENT_DATE)
                          AND (end_date   IS NULL OR end_date   >= CURRENT_DATE)
                        LIMIT 1
                    """), {"pid": entry_project_id})
                    phase_id = phase_result.scalar_one_or_none()

                po_label = po_row["po_number"] or f"#{po_id}"
                await db.execute(text("""
                    INSERT INTO budget_entries (
                        project_id, phase_id, entry_type,
                        reference_id, reference_type,
                        description, amount, entry_date, is_overhead, created_by
                    ) VALUES (
                        :project_id, :phase_id, 'purchase_order',
                        :reference_id, 'po_receipt',
                        :description, :amount, CURRENT_DATE, :is_overhead, :created_by
                    )
                """), {
                    "project_id":  entry_project_id,
                    "phase_id":    phase_id,
                    "reference_id": receipt_id,
                    "description": f"PO {po_label} — {li['description']} received "
                                    f"({item.quantity_received:g} {li['unit']})",
                    "amount":      amount,
                    "is_overhead": is_overhead_entry,
                    "created_by":  user.id,
                })

                if entry_project_id is not None:
                    await db.execute(text(
                        "SELECT fn_check_budget_alert(:pid, :phid)"
                    ), {"pid": entry_project_id, "phid": phase_id})

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


@router.patch("/{po_id}/date")
async def update_po_placed_date(
    po_id: int,
    body:  PlacedDateIn,
    db     = Depends(get_db),
    user   = Depends(require_po_approver),
):
    """
    Correct the order date on an existing PO — for back-logging an order that
    was actually placed earlier but is only now being entered into the system.
    """
    result = await db.execute(text(
        "SELECT id FROM purchase_orders WHERE id = :id"
    ), {"id": po_id})
    if not result.one_or_none():
        raise HTTPException(404, "Purchase order not found.")

    await db.execute(text("""
        UPDATE purchase_orders SET placed_date = :placed_date, updated_at = NOW()
        WHERE id = :id
    """), {"placed_date": body.placed_date, "id": po_id})

    await db.commit()
    return {"message": "Order date updated."}


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
