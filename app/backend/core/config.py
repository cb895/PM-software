"""
core/config.py — App settings from environment variables
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    database_url:     str
    secret_key:       str
    fernet_key:       str
    upload_dir:       str = "/app/uploads"
    reports_dir:      str = "/app/reports"

    # Comma-separated in the environment (e.g. "http://localhost,http://192.168.1.100").
    # Kept as a plain str field — pydantic-settings tries to JSON-decode List[str] env
    # values, which raises a SettingsError on a plain comma-separated string.
    allowed_origins_raw: str = Field("http://localhost", alias="allowed_origins")

    # JWT
    algorithm:        str = "HS256"
    access_token_expire_minutes: int = 480  # 8 hours
    anthropic_api_key:          str = ""
    gmail_sender:               str = "cb@metabolictrack.com"
    gmail_app_password:         str = ""

    class Config:
        env_file = ".env"
        populate_by_name = True

    @property
    def allowed_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]


settings = Settings()
