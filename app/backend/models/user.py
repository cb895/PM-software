"""
models/user.py — User ORM model
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum as SAEnum
from sqlalchemy.sql import func
from core.database import Base
import enum


class UserRole(str, enum.Enum):
    lab_tech    = "lab_tech"
    ops_manager = "ops_manager"
    qm_director = "qm_director"
    ceo         = "ceo"


class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True)
    full_name       = Column(String(120), nullable=False)
    email           = Column(String(255), nullable=False, unique=True)
    hashed_password = Column(String,      nullable=False)
    role            = Column(SAEnum(UserRole, name="user_role"), nullable=False)
    is_active       = Column(Boolean, nullable=False, default=True)
    failed_login_count = Column(Integer, nullable=False, default=0)
    locked_until    = Column(DateTime(timezone=True))
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
