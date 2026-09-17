"""
core/security.py — JWT, password hashing, role-based dependencies
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.config   import settings
from core.database import get_db

pwd_context    = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme  = OAuth2PasswordBearer(tokenUrl="/auth/token")
fernet         = Fernet(settings.fernet_key.encode())


# ---- Password ----

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ---- Fernet encryption (supplier credentials) ----

def encrypt_value(value: str) -> str:
    if not value:
        return ""
    return fernet.encrypt(value.encode()).decode()


def decrypt_value(encrypted: str) -> str:
    if not encrypted:
        return ""
    return fernet.decrypt(encrypted.encode()).decode()


# ---- JWT ----

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


# ---- Current user dependency ----

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    from models.user import User  # avoid circular import

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired session. Please log in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise credentials_exception
    return user


# ---- Role dependencies ----

def require_roles(*roles: str):
    async def checker(current_user=Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to access this resource.",
            )
        return current_user
    return checker


# ---- Convenience role dependencies ----

# Single role
require_ops_manager = require_roles("ops_manager")

# Purchase orders — all roles can submit AND view all; ops+ceo+qm approve
require_po_approver = require_roles("ops_manager", "ceo", "qm_director")

# Suppliers — edit: ops + qm; credentials view: ops + ceo + qm
require_supplier_editor    = require_roles("ops_manager", "qm_director")
require_credentials_access = require_roles("ops_manager", "ceo", "qm_director")

# Tasks — create/edit: ops + ceo only
require_task_editor = require_roles("ops_manager", "ceo")

# Budget — view + edit amounts + manual entry: ops + ceo
require_budget_access = require_roles("ops_manager", "ceo")

# KPI — all actions: ops + ceo
require_kpi_access  = require_roles("ops_manager", "ceo")
require_kpi_manager = require_roles("ops_manager", "ceo")

# Reports — all actions (generate, edit, publish, read): ops + ceo
require_report_manager = require_roles("ops_manager", "ceo")

# Any authenticated user
require_any = Depends(get_current_user)
