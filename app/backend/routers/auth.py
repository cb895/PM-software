"""
routers/auth.py — Login, token, current user
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone

from core.database import get_db
from core.security import verify_password, hash_password, create_access_token, get_current_user
from models.user   import User

router = APIRouter()

# Brute-force protection: lock an account for LOCKOUT_MINUTES after
# MAX_FAILED_ATTEMPTS consecutive wrong passwords.
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES      = 15


class Token(BaseModel):
    access_token: str
    token_type:   str = "bearer"


class UserOut(BaseModel):
    id:        int
    full_name: str
    email:     str
    role:      str

    class Config:
        from_attributes = True


@router.post("/token", response_model=Token)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db:   AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.email == form.username, User.is_active == True)
    )
    user = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if user and user.locked_until and user.locked_until > now:
        wait_minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Too many failed login attempts. Try again in {wait_minutes} minute(s).",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user or not verify_password(form.password, user.hashed_password):
        if user:
            user.failed_login_count += 1
            if user.failed_login_count >= MAX_FAILED_ATTEMPTS:
                user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_login_count = 0
            await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.failed_login_count or user.locked_until:
        user.failed_login_count = 0
        user.locked_until = None
        await db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role})
    return Token(access_token=token)


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/users")
async def list_users(
    db:           AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns all active users — used for assignee dropdowns."""
    result = await db.execute(
        text("SELECT id, full_name, role, email FROM users WHERE is_active = TRUE ORDER BY full_name")
    )
    return [dict(r) for r in result.mappings()]


# ---- Password management ----

class PasswordChange(BaseModel):
    current_password: str
    new_password:     str

class AdminPasswordReset(BaseModel):
    new_password: str

class UserCreate(BaseModel):
    full_name: str
    email:     str
    password:  str
    role:      str

class UserUpdate(BaseModel):
    full_name:  Optional[str] = None
    role:       Optional[str] = None
    is_active:  Optional[bool] = None


@router.post("/change-password")
async def change_password(
    body:         PasswordChange,
    db:           AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Any user can change their own password."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")

    new_hash = hash_password(body.new_password)
    await db.execute(
        text("UPDATE users SET hashed_password = :h, updated_at = NOW() WHERE id = :id"),
        {"h": new_hash, "id": current_user.id}
    )
    await db.commit()
    return {"message": "Password updated successfully."}


@router.get("/users/all")
async def list_all_users(
    db:           AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns all users — ops manager sees everything; others see active only."""
    from core.security import require_roles as rr
    if current_user.role == "ops_manager":
        result = await db.execute(text(
            "SELECT id, full_name, email, role, is_active, created_at, updated_at FROM users ORDER BY role, full_name"
        ))
    else:
        result = await db.execute(text(
            "SELECT id, full_name, email, role, is_active, created_at FROM users WHERE is_active = TRUE ORDER BY full_name"
        ))
    return [dict(r) for r in result.mappings()]


@router.post("/users/create", status_code=201)
async def create_user(
    body:         UserCreate,
    db:           AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ops manager only — create a new user account."""
    if current_user.role != "ops_manager":
        raise HTTPException(403, "Only the operations manager can create accounts.")

    valid_roles = ["lab_tech", "ops_manager", "qm_director", "ceo"]
    if body.role not in valid_roles:
        raise HTTPException(400, f"Role must be one of: {valid_roles}")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")

    existing = await db.execute(text("SELECT id FROM users WHERE email = :e"), {"e": body.email})
    if existing.scalar_one_or_none():
        raise HTTPException(400, "An account with that email already exists.")

    hashed = hash_password(body.password)
    result = await db.execute(text("""
        INSERT INTO users (full_name, email, hashed_password, role, is_active)
        VALUES (:full_name, :email, :hashed, :role, TRUE)
        RETURNING id
    """), {"full_name": body.full_name, "email": body.email, "hashed": hashed, "role": body.role})
    user_id = result.scalar_one()
    await db.commit()
    return {"id": user_id, "message": f"Account created for {body.full_name}."}


@router.patch("/users/{user_id}")
async def update_user(
    user_id:      int,
    body:         UserUpdate,
    db:           AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ops manager only — update name, role, or active status."""
    if current_user.role != "ops_manager":
        raise HTTPException(403, "Only the operations manager can modify accounts.")

    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update.")

    set_clause = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = user_id
    await db.execute(text(
        f"UPDATE users SET {set_clause}, updated_at = NOW() WHERE id = :id"
    ), data)
    await db.commit()
    return {"message": "User updated."}


@router.post("/users/{user_id}/deactivate")
async def deactivate_user(
    user_id:      int,
    db:           AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Ops manager only — soft-deactivate an account.
    All data contributed by this user is preserved.
    The user can no longer log in.
    """
    if current_user.role != "ops_manager":
        raise HTTPException(403, "Only the operations manager can deactivate accounts.")
    if user_id == current_user.id:
        raise HTTPException(400, "You cannot deactivate your own account.")

    result = await db.execute(text(
        "SELECT full_name, is_active FROM users WHERE id = :id"
    ), {"id": user_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "User not found.")
    if not row[1]:
        raise HTTPException(400, f"{row[0]}'s account is already inactive.")

    await db.execute(text(
        "UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = :id"
    ), {"id": user_id})
    await db.commit()
    return {"message": f"{row[0]}'s account has been deactivated. All their data is preserved."}


@router.post("/users/{user_id}/reactivate")
async def reactivate_user(
    user_id:      int,
    db:           AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ops manager only — reactivate a previously deactivated account."""
    if current_user.role != "ops_manager":
        raise HTTPException(403, "Only the operations manager can reactivate accounts.")

    await db.execute(text(
        "UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE id = :id"
    ), {"id": user_id})
    await db.commit()
    return {"message": "Account reactivated."}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id:      int,
    body:         AdminPasswordReset,
    db:           AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ops manager only — reset any user's password."""
    if current_user.role != "ops_manager":
        raise HTTPException(403, "Only the operations manager can reset passwords.")
    if len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")

    result = await db.execute(text("SELECT full_name FROM users WHERE id = :id"), {"id": user_id})
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "User not found.")

    new_hash = hash_password(body.new_password)
    await db.execute(text(
        "UPDATE users SET hashed_password = :h, updated_at = NOW() WHERE id = :id"
    ), {"h": new_hash, "id": user_id})
    await db.commit()
    return {"message": f"Password reset for {row[0]}."}
