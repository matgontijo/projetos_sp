from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # SQLite por padrao para rodar sem infra; use postgresql+psycopg://... em producao
    database_url: str = f"sqlite:///{BASE_DIR / 'custeio.db'}"
    # Chave Fernet (base64). Se vazia, uma chave local e gerada em backend/.secret_key
    app_encryption_key: str = ""
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    omie_base_url: str = "https://app.omie.com.br/api/v1"
    # Intervalo minimo entre chamadas a Omie por empresa (segundos)
    omie_min_interval: float = 0.35

    @field_validator("database_url")
    @classmethod
    def _normaliza_url_postgres(cls, url: str) -> str:
        # Render/Heroku entregam postgres:// (ou postgresql://) sem driver;
        # SQLAlchemy precisa do dialeto +psycopg
        if url.startswith("postgres://"):
            return "postgresql+psycopg://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            return "postgresql+psycopg://" + url[len("postgresql://"):]
        return url


settings = Settings()
