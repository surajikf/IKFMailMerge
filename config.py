import os
import warnings
from pathlib import Path
from cryptography.fernet import Fernet

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _resolve_path(value: str, default_name: str) -> Path:
    raw = value.strip() if value else default_name
    path = Path(raw)
    if not path.is_absolute():
        path = BASE_DIR / path
    return path


APP_ENV: str = os.getenv("APP_ENV", "production").strip().lower()
APP_HOST: str = os.getenv("APP_HOST", "0.0.0.0").strip()
APP_PORT: int = int(os.getenv("APP_PORT", "8000"))

DATA_DIR: Path = _resolve_path(os.getenv("APP_DATA_DIR", ""), "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'sql_app.db').as_posix()}")

TOKEN_PATH: Path = _resolve_path(os.getenv("GMAIL_TOKEN_PATH", ""), str(DATA_DIR / "token.json"))
CREDENTIALS_PATH: Path = _resolve_path(os.getenv("GMAIL_CREDENTIALS_PATH", ""), "credentials.json")
LOGO_PATH: Path = _resolve_path(os.getenv("APP_LOGO_PATH", ""), "public/ikf.png")

ALLOWED_ORIGINS: list[str] = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()]
if not ALLOWED_ORIGINS and APP_ENV == "development":
    ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"]

ADMIN_ACCESS_TOKEN: str = os.getenv("ADMIN_ACCESS_TOKEN", "").strip()


def _load_or_create_secret_key() -> str:
    # Prefer ENCRYPTION_KEY; fall back to legacy APP_SECRET_KEY for zero-downtime migration.
    env_key = (
        os.getenv("ENCRYPTION_KEY", "").strip()
        or os.getenv("APP_SECRET_KEY", "").strip()
    )
    if env_key:
        return env_key

    # Legacy: read from file if it exists — operators should move the value to
    # ENCRYPTION_KEY in their .env file and then delete data/secret.key.
    secret_key_path = _resolve_path(
        os.getenv("APP_SECRET_KEY_PATH", ""), str(DATA_DIR / "secret.key")
    )
    if secret_key_path.exists():
        warnings.warn(
            "Fernet key loaded from data/secret.key. "
            "Move the value to the ENCRYPTION_KEY environment variable and delete the file.",
            stacklevel=1,
        )
        return secret_key_path.read_text(encoding="utf-8").strip()

    # No key found — generate ephemeral key. Encrypted secrets will not survive restart.
    generated = Fernet.generate_key().decode("utf-8")
    warnings.warn(
        "ENCRYPTION_KEY is not set. Generated an ephemeral Fernet key. "
        "Encrypted secrets (SMTP passwords, Brevo API keys) will NOT survive a restart. "
        "Set ENCRYPTION_KEY in your .env file to persist encryption.",
        stacklevel=1,
    )
    return generated


APP_SECRET_KEY: str = _load_or_create_secret_key()
