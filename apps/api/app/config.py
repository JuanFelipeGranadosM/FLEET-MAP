"""Configuración por variables de entorno (prefijo FLEETMAP_)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FLEETMAP_", env_file=".env", extra="ignore")

    # "mock" usa el simulador; "excel" lee el libro ARRANQUE DIARIO DE EQUIPOS;
    # "aemp" consulta una API ISO 15143-3 real.
    provider: str = "mock"
    excel_path: str = ""
    sites_path: str = "sites.json"
    today: str = "2026-10-20"
    history_days: int = 180
    cors_origins: list[str] = ["http://localhost:5173"]
    # PostgreSQL con db/schema.sql, 002 y 003 (facturación). Vacío: los endpoints /finance responden 503.
    database_url: str = ""

    # AEMP / ISO 15143-3 (sólo con provider = "aemp")
    aemp_base_url: str = ""
    aemp_token_url: str = ""
    aemp_client_id: str = ""
    aemp_client_secret: str = ""
    aemp_scope: str = ""
    # JSON con el maestro de activos: { "<PIN>": { "typeId", "siteId", "rate", "standbyFactor" } }
    asset_master_path: str = "asset_master.json"


settings = Settings()
