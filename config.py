import os
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


APP_ENV = os.getenv("APP_ENV", "production").strip().lower()
APP_HOST = os.getenv("APP_HOST", "0.0.0.0").strip()
APP_PORT = int(os.getenv("APP_PORT", "8000"))

DATA_DIR = _resolve_path(os.getenv("APP_DATA_DIR", ""), "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'sql_app.db').as_posix()}")

TOKEN_PATH = _resolve_path(os.getenv("GMAIL_TOKEN_PATH", ""), str(DATA_DIR / "token.json"))
CREDENTIALS_PATH = _resolve_path(os.getenv("GMAIL_CREDENTIALS_PATH", ""), "credentials.json")
LOGO_PATH = _resolve_path(os.getenv("APP_LOGO_PATH", ""), "public/ikf.png")
SECRET_KEY_PATH = _resolve_path(os.getenv("APP_SECRET_KEY_PATH", ""), str(DATA_DIR / "secret.key"))

ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()]
if not ALLOWED_ORIGINS and APP_ENV == "development":
    ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"]

ADMIN_ACCESS_TOKEN = os.getenv("ADMIN_ACCESS_TOKEN", "").strip()


def _load_or_create_secret_key() -> str:
    env_key = os.getenv("APP_SECRET_KEY", "").strip()
    if env_key:
        return env_key

    if SECRET_KEY_PATH.exists():
        return SECRET_KEY_PATH.read_text(encoding="utf-8").strip()

    generated = Fernet.generate_key().decode("utf-8")
    SECRET_KEY_PATH.write_text(generated, encoding="utf-8")
    return generated


APP_SECRET_KEY = _load_or_create_secret_key()
