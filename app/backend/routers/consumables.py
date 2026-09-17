"""routers/consumables.py — Consumables endpoints"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel
from core.database import get_db
from core.security import get_current_user, require_roles

router = APIRouter()

# ---- Schemas ----

class ConsumableCreate(BaseModel):
    name:                  str
    category:              str = 'reagent'
    sku:                   Optional[str]   = None
    unit:                  str = 'each'
    current_stock:         float
    reorder_threshold:     float = 0
    reorder_quantity:      Optional[float] = None
    unit_cost:             Optional[float] = None
    location:              Optional[str]   = None
    description:           Optional[str]   = None
    is_shared:             bool = False
    auto_reorder:          bool = True
    project_id:            Optional[int]   = None
    preferred_supplier_id: Optional[int]   = None

class ConsumableUpdate(BaseModel):
    name:                  Optional[str]   = None
    category:              Optional[str]   = None
    sku:                   Optional[str]   = None
    unit:                  Optional[str]   = None
    reorder_threshold:     Optional[float] = None
    reorder_quantity:      Optional[float] = None
    unit_cost:             Optional[float] = None
    location:              Optional[str]   = None
    description:           Optional[str]   = None
    is_shared:             Optional[bool]  = None
    auto_reorder:          Optional[bool]  = None
    is_active:             Optional[bool]  = None
    preferred_supplier_id: Optional[int]   = None

class StockAdjust(BaseModel):
    transaction_type: str       # 'restock' | 'usage' | 'adjustment'
    quantity:         float
    project_id:       Optional[int] = None
    notes:            Optional[str] = None

# ---- Endpoints ----

@router.get("")
async def list_consumables(db = Depends(get_db), user = Depends(get_current_user)):
    result = await db.execute(text("""
        SELECT c.id, c.name, c.sku, c.category, c.unit, c.is_shared,
               c.current_stock, c.reorder_threshold, c.reorder_quantity,
               c.unit_cost, c.location, c.auto_reorder, c.reorder_po_drafted,
               c.is_active, c.last_restocked, c.description,
               c.project_id, c.preferred_supplier_id,
               p.code  AS project_code,
               s.name  AS preferred_supplier
        FROM consumables c
        LEFT JOIN projects p  ON p.id = c.project_id
        LEFT JOIN suppliers s ON s.id = c.preferred_supplier_id
        WHERE c.is_active = TRUE
        ORDER BY c.category, c.name
    """))
    return [dict(r) for r in result.mappings()]


@router.get("/restock-flags")
async def restock_flags(db = Depends(get_db), user = Depends(get_current_user)):
    result = await db.execute(text(
        "SELECT * FROM consumables_needing_restock ORDER BY name"
    ))
    return [dict(r) for r in result.mappings()]


@router.get("/dropdown")
async def consumables_dropdown(db = Depends(get_db), user = Depends(get_current_user)):
    result = await db.execute(text("SELECT * FROM consumables_dropdown"))
    return [dict(r) for r in result.mappings()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_consumable(
    body: ConsumableCreate,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text("""
        INSERT INTO consumables
            (name, category, sku, unit, current_stock, reorder_threshold,
             reorder_quantity, unit_cost, location, description,
             is_shared, auto_reorder, project_id, preferred_supplier_id, is_active)
        VALUES
            (:name, :category, :sku, :unit, :current_stock, :reorder_threshold,
             :reorder_quantity, :unit_cost, :location, :description,
             :is_shared, :auto_reorder, :project_id, :preferred_supplier_id, TRUE)
        RETURNING id
    """), body.model_dump())
    consumable_id = result.scalar_one()
    await db.commit()
    return {"id": consumable_id, "message": "Consumable added."}



@router.get("/restock-check")
async def trigger_restock_check(
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """Manually trigger auto-reorder PO creation for all low-stock items."""
    result = await db.execute(text("SELECT fn_auto_reorder_pos()"))
    count = result.scalar_one()
    await db.commit()
    return {"pos_created": count, "message": f"{count} reorder PO(s) created."}

@router.get("/{consumable_id}")
async def get_consumable(consumable_id: int, db = Depends(get_db), user = Depends(get_current_user)):
    result = await db.execute(text("""
        SELECT c.*, p.code AS project_code, s.name AS preferred_supplier
        FROM consumables c
        LEFT JOIN projects p  ON p.id = c.project_id
        LEFT JOIN suppliers s ON s.id = c.preferred_supplier_id
        WHERE c.id = :id
    """), {"id": consumable_id})
    row = result.mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Consumable not found.")
    return dict(row)


@router.patch("/{consumable_id}")
async def update_consumable(
    consumable_id: int,
    body: ConsumableUpdate,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update.")
    set_clause = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = consumable_id
    await db.execute(text(
        f"UPDATE consumables SET {set_clause}, updated_at = NOW() WHERE id = :id"
    ), data)
    await db.commit()
    return {"message": "Consumable updated."}


@router.post("/{consumable_id}/adjust")
async def adjust_stock(
    consumable_id: int,
    body: StockAdjust,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    # Validate transaction type
    if body.transaction_type not in ('restock', 'usage', 'adjustment'):
        raise HTTPException(400, "Invalid transaction type.")

    # Get current stock
    result = await db.execute(text(
        "SELECT current_stock, unit FROM consumables WHERE id = :id"
    ), {"id": consumable_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Consumable not found.")

    current, unit = row
    change = body.quantity if body.transaction_type == 'restock' else -body.quantity
    new_stock = float(current) + change

    if new_stock < 0:
        raise HTTPException(400, f"Insufficient stock. Current: {current} {unit}.")

    # Update stock — the auto-reorder trigger fires automatically
    await db.execute(text("""
        UPDATE consumables
        SET current_stock = :new_stock,
            last_restocked = CASE WHEN :txn_type = 'restock' THEN CURRENT_DATE ELSE last_restocked END,
            updated_at = NOW()
        WHERE id = :id
    """), {"new_stock": new_stock, "txn_type": body.transaction_type, "id": consumable_id})

    # Record transaction
    await db.execute(text("""
        INSERT INTO consumable_transactions
            (consumable_id, user_id, project_id, quantity_change, transaction_type, notes)
        VALUES (:consumable_id, :user_id, :project_id, :change, :txn_type, :notes)
    """), {
        "consumable_id": consumable_id,
        "user_id":       user.id,
        "project_id":    body.project_id,
        "change":        change,
        "txn_type":      body.transaction_type,
        "notes":         body.notes,
    })

    await db.commit()
    return {"message": "Stock updated.", "new_stock": new_stock}


@router.get("/{consumable_id}/transactions")
async def get_transactions(
    consumable_id: int,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT ct.id, ct.quantity_change, ct.transaction_type, ct.notes,
               ct.transaction_date, u.full_name, p.code AS project_code
        FROM consumable_transactions ct
        JOIN users u    ON u.id  = ct.user_id
        LEFT JOIN projects p ON p.id = ct.project_id
        WHERE ct.consumable_id = :id
        ORDER BY ct.transaction_date DESC
        LIMIT 100
    """), {"id": consumable_id})
    return [dict(r) for r in result.mappings()]


@router.delete("/{consumable_id}")
async def delete_consumable(
    consumable_id: int,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """Soft-delete: marks as inactive. Preserves transaction history."""
    result = await db.execute(text(
        "SELECT name FROM consumables WHERE id = :id"
    ), {"id": consumable_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Consumable not found.")

    await db.execute(text(
        "UPDATE consumables SET is_active = FALSE, updated_at = NOW() WHERE id = :id"
    ), {"id": consumable_id})
    await db.commit()
    return {"message": f"{row[0]} removed from active inventory. Transaction history preserved."}


@router.post("/{consumable_id}/reorder")
async def manual_reorder(
    consumable_id: int,
    db   = Depends(get_db),
    user = Depends(get_current_user),
):
    """Manually trigger a reorder PO for a specific consumable."""
    result = await db.execute(text("""
        SELECT c.id, c.name, c.sku, c.reorder_quantity, c.unit,
               c.unit_cost, c.project_id, c.preferred_supplier_id,
               s.code AS supplier_code
        FROM consumables c
        LEFT JOIN suppliers s ON s.id = c.preferred_supplier_id
        WHERE c.id = :id AND c.is_active = TRUE
    """), {"id": consumable_id})
    item = result.mappings().one_or_none()
    if not item:
        raise HTTPException(404, "Consumable not found.")

    # Create draft PO
    po_result = await db.execute(text("""
        INSERT INTO purchase_orders (
            project_id, supplier_id, supplier_name_free,
            status, priority, notes, requested_by
        ) VALUES (
            :project_id,
            :supplier_id,
            :supplier_name_free,
            'pending', 'normal',
            :notes,
            :requested_by
        ) RETURNING id
    """), {
        "project_id":        item["project_id"],
        "supplier_id":       item["preferred_supplier_id"],
        "supplier_name_free": "Pending — supplier to be assigned" if not item["preferred_supplier_id"] else None,
        "notes":             f"Manual reorder request — {item['name']}.",
        "requested_by":      user.id,
    })
    po_id = po_result.scalar_one()

    # Add line item
    await db.execute(text("""
        INSERT INTO po_line_items
            (po_id, description, product_id, quantity_ordered, unit, unit_cost_estimate)
        VALUES
            (:po_id, :desc, :sku,
             :qty, :unit, :cost)
    """), {
        "po_id": po_id,
        "desc":  item["name"],
        "sku":   item["sku"],
        "qty":   item["reorder_quantity"] or 1,
        "unit":  item["unit"],
        "cost":  item["unit_cost"],
    })

    # Reset draft flag so auto-reorder can fire again next time
    await db.execute(text(
        "UPDATE consumables SET reorder_po_drafted = FALSE, updated_at = NOW() WHERE id = :id"
    ), {"id": consumable_id})

    await db.commit()
    return {"po_id": po_id, "message": f"Reorder PO created for {item['name']}."}
