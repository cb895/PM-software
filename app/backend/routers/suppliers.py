"""routers/suppliers.py — Supplier endpoints"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel
from core.database import get_db
from core.security import get_current_user, require_roles, require_supplier_editor, require_credentials_access, encrypt_value, decrypt_value
from services.document_service import dispatch_new_supplier

router = APIRouter()

# ---- Schemas ----

class SupplierCreate(BaseModel):
    name:               str
    code:               Optional[str] = None
    supplier_type:      Optional[str] = None
    contact_name:       Optional[str] = None
    phone:              Optional[str] = None
    email:              Optional[str] = None
    address:            Optional[str] = None
    website:            Optional[str] = None
    notes:              Optional[str] = None
    onboarding_status:  Optional[str] = 'To do'
    is_active:          bool = True

class SupplierUpdate(BaseModel):
    name:               Optional[str] = None
    code:               Optional[str] = None
    supplier_type:      Optional[str] = None
    contact_name:       Optional[str] = None
    phone:              Optional[str] = None
    email:              Optional[str] = None
    address:            Optional[str] = None
    website:            Optional[str] = None
    notes:              Optional[str] = None
    onboarding_status:  Optional[str] = None
    is_active:          Optional[bool] = None

class CredentialsUpdate(BaseModel):
    portal_url:     Optional[str] = None
    username:       Optional[str] = None
    password:       Optional[str] = None  # plain text — encrypted before storage
    portal_email:   Optional[str] = None
    account_number: Optional[str] = None
    notes:          Optional[str] = None

# ---- Endpoints ----

@router.get("")
async def list_suppliers(
    active: Optional[bool] = Query(None),
    db     = Depends(get_db),
    user   = Depends(get_current_user),
):
    where = "WHERE s.is_active = TRUE" if active else ""
    result = await db.execute(text(f"""
        SELECT s.id, s.name, s.code, s.website, s.supplier_type,
               s.onboarding_status, s.is_active, s.notes,
               s.contact_name, s.phone, s.email, s.address,
               STRING_AGG(sc.category, ', ' ORDER BY sc.category) AS categories
        FROM suppliers s
        LEFT JOIN supplier_categories sc ON sc.supplier_id = s.id
        {where}
        GROUP BY s.id
        ORDER BY s.name
    """))
    return [dict(r) for r in result.mappings()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_supplier(
    body: SupplierCreate,
    db   = Depends(get_db),
    user = Depends(require_supplier_editor),
):
    result = await db.execute(text("""
        INSERT INTO suppliers
            (name, code, supplier_type, contact_name, phone, email,
             address, website, notes, onboarding_status, is_active)
        VALUES
            (:name, :code, :supplier_type, :contact_name, :phone, :email,
             :address, :website, :notes, :onboarding_status, :is_active)
        RETURNING id
    """), body.model_dump())
    supplier_id = result.scalar_one()
    await db.commit()
    dispatch_new_supplier(supplier_id, user.full_name)
    return {"id": supplier_id, "message": "Supplier created."}


@router.get("/{supplier_id}")
async def get_supplier(
    supplier_id: int,
    db  = Depends(get_db),
    user = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT s.id, s.name, s.code, s.website, s.supplier_type,
               s.onboarding_status, s.is_active, s.notes,
               s.contact_name, s.phone, s.email, s.address,
               STRING_AGG(sc.category, ', ' ORDER BY sc.category) AS categories
        FROM suppliers s
        LEFT JOIN supplier_categories sc ON sc.supplier_id = s.id
        WHERE s.id = :id
        GROUP BY s.id
    """), {"id": supplier_id})
    row = result.mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Supplier not found.")
    return dict(row)


@router.patch("/{supplier_id}")
async def update_supplier(
    supplier_id: int,
    body: SupplierUpdate,
    db   = Depends(get_db),
    user = Depends(require_supplier_editor),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update.")

    set_clause = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = supplier_id

    await db.execute(text(f"""
        UPDATE suppliers SET {set_clause}, updated_at = NOW()
        WHERE id = :id
    """), data)
    await db.commit()
    return {"message": "Supplier updated."}


@router.get("/{supplier_id}/credentials")
async def get_credentials(
    supplier_id: int,
    db   = Depends(get_db),
    user = Depends(require_credentials_access),
):
    result = await db.execute(text("""
        SELECT portal_url, username, encrypted_password,
               portal_email, account_number, notes, updated_at
        FROM supplier_credentials
        WHERE supplier_id = :id
    """), {"id": supplier_id})
    row = result.mappings().one_or_none()
    if not row:
        return {"message": "No credentials on file."}

    data = dict(row)
    # Decrypt password for display (returned masked — actual reveal done client-side if needed)
    if data.get("encrypted_password"):
        try:
            data["decrypted_password"] = decrypt_value(data["encrypted_password"])
        except Exception:
            data["decrypted_password"] = None
    del data["encrypted_password"]
    return data


@router.put("/{supplier_id}/credentials")
async def upsert_credentials(
    supplier_id: int,
    body: CredentialsUpdate,
    db   = Depends(get_db),
    user = Depends(require_roles("ops_manager")),
):
    # Encrypt password if provided
    encrypted = None
    if body.password:
        encrypted = encrypt_value(body.password)

    # Check if credentials row exists
    existing = await db.execute(text(
        "SELECT id, encrypted_password FROM supplier_credentials WHERE supplier_id = :id"
    ), {"id": supplier_id})
    row = existing.one_or_none()

    if row:
        # Update existing — keep old password if not changing
        enc_pw = encrypted if encrypted else row[1]
        await db.execute(text("""
            UPDATE supplier_credentials
            SET portal_url = :portal_url, username = :username,
                encrypted_password = :enc_pw, portal_email = :portal_email,
                account_number = :account_number, notes = :notes, updated_at = NOW()
            WHERE supplier_id = :supplier_id
        """), {
            "portal_url":     body.portal_url,
            "username":       body.username,
            "enc_pw":         enc_pw,
            "portal_email":   body.portal_email,
            "account_number": body.account_number,
            "notes":          body.notes,
            "supplier_id":    supplier_id,
        })
    else:
        # Insert new
        await db.execute(text("""
            INSERT INTO supplier_credentials
                (supplier_id, portal_url, username, encrypted_password,
                 portal_email, account_number, notes)
            VALUES
                (:supplier_id, :portal_url, :username, :enc_pw,
                 :portal_email, :account_number, :notes)
        """), {
            "supplier_id":    supplier_id,
            "portal_url":     body.portal_url,
            "username":       body.username,
            "enc_pw":         encrypted,
            "portal_email":   body.portal_email,
            "account_number": body.account_number,
            "notes":          body.notes,
        })

    await db.commit()
    return {"message": "Credentials updated."}
