from fastapi import FastAPI, Depends, UploadFile, File, HTTPException, Form, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import os
import re
import json
import datetime
import time
import logging
import io
import base64
import uuid
import traceback
import threading
import random
import mimetypes
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from urllib.parse import quote
from sqlalchemy.orm import Session
from sqlalchemy import func, text
import pandas as pd

import models
import schemas
import auth
from config import ALLOWED_ORIGINS, APP_ENV, APP_PORT, CREDENTIALS_PATH, DATA_DIR, LOGO_PATH, TOKEN_PATH
from database import SessionLocal, engine, get_db
from security import decrypt_secret, encrypt_secret

# Configure Logging
log_file = os.path.join(DATA_DIR, "debug.log")
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file, mode='a', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("api")
logger.info(f"Logging initialized. Log file: {log_file}")
API_VERSION = "2026-03-31-v2-compat"

# Initialize Database
models.Base.metadata.create_all(bind=engine)

# --- Monolith: one process serves /api/* and the React SPA built to ./dist (see static routes at EOF). ---
app = FastAPI(title="IKF MailMerge", description="API + static UI (run `npm run build` before production).")
WORKER_POLL_SECONDS = max(1, int(os.getenv("IKF_WORKER_POLL_SECONDS", "2")))
worker_shutdown_event = threading.Event()
worker_thread: Optional[threading.Thread] = None
MAX_BATCH_WORKERS = max(1, min(20, int(os.getenv("IKF_MAX_BATCH_WORKERS", "5"))))
ATTACHMENTS_ROOT = os.path.join(DATA_DIR, "attachments")
MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_TOTAL_MB = max(1, int(os.getenv("IKF_MAX_ATTACHMENTS_TOTAL_MB", "20")))
MAX_ATTACHMENTS_TOTAL_BYTES = MAX_ATTACHMENTS_TOTAL_MB * 1024 * 1024
MAX_ATTACHMENTS_PER_BATCH = 10
ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".pdf", ".xlsx", ".xls", ".csv",
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".doc", ".docx", ".txt", ".zip",
    ".mp3", ".wav", ".m4a",
}
os.makedirs(ATTACHMENTS_ROOT, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=bool(ALLOWED_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def admin_access_middleware(request: Request, call_next):
    # This middleware is being phased out in favor of Depends(get_current_active_admin)
    # But we keep it for now to avoid breaking the build while transitioning.
    return await call_next(request)


def error_detail(message: str, code: str, hint: Optional[str] = None):
    payload = {"message": message, "code": code}
    if hint:
        payload["hint"] = hint
    return payload


def get_batch_attachments_dir(batch_id: str) -> str:
    safe_batch = re.sub(r"[^a-zA-Z0-9_\-]", "_", (batch_id or "").strip())
    path = os.path.join(ATTACHMENTS_ROOT, safe_batch)
    os.makedirs(path, exist_ok=True)
    return path


def sanitize_attachment_filename(filename: str) -> str:
    base = os.path.basename(filename or "attachment.bin")
    return re.sub(r"[^a-zA-Z0-9._\- ]", "_", base).strip() or "attachment.bin"


def attachment_payloads_for_batch(db: Session, batch_id: str) -> list[dict]:
    items = db.query(models.BatchAttachment).filter(
        models.BatchAttachment.batch_id == batch_id
    ).order_by(models.BatchAttachment.created_at.asc()).all()
    payloads = []
    for item in items:
        full_path = os.path.join(get_batch_attachments_dir(batch_id), item.stored_filename)
        if not os.path.exists(full_path):
            continue
        try:
            with open(full_path, "rb") as f:
                content = f.read()
            mime = item.mime_type or mimetypes.guess_type(item.original_filename)[0] or "application/octet-stream"
            payloads.append({
                "filename": item.original_filename,
                "mime_type": mime,
                "content_bytes": content,
            })
        except Exception:
            continue
    return payloads


def get_batch_attachment_stats(db: Session, batch_id: str) -> dict:
    row = (
        db.query(
            func.count(models.BatchAttachment.id).label("count"),
            func.coalesce(func.sum(models.BatchAttachment.file_size), 0).label("total_bytes"),
        )
        .filter(models.BatchAttachment.batch_id == batch_id)
        .one()
    )
    return {"count": row.count, "total_bytes": row.total_bytes}


def ensure_batch_exists_for_attachments(db: Session, batch_id: str):
    if get_batch_job(db, batch_id):
        return
    if db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id).first():
        return
    raise HTTPException(
        status_code=404,
        detail=error_detail("Batch not found.", "batch_not_found", "Create or process a batch before adding attachments."),
    )


def utc_now_aware() -> datetime.datetime:
    """UTC 'now' as timezone-aware (use for comparisons with ISO datetimes from clients)."""
    return datetime.datetime.now(datetime.timezone.utc)


def to_utc_aware(dt: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """Normalize naive datetimes to UTC; convert other zones to UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else error_detail(str(exc.detail), "http_error")
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "detail": detail})


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_request: Request, exc: RequestValidationError):
    issues = []
    for item in exc.errors():
        location = " -> ".join(str(part) for part in item.get("loc", []) if part != "body")
        message = item.get("msg", "Invalid value")
        issues.append(f"{location}: {message}" if location else message)

    return JSONResponse(
        status_code=422,
        content={
            "ok": False,
            "detail": error_detail(
                "Some fields are missing or invalid.",
                "validation_error",
                "Review the highlighted form inputs and try again."
            ),
            "issues": issues
        }
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    logger.error("Unhandled server error: %s\n%s", exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "detail": error_detail(
                "The server hit an unexpected problem while processing this request.",
                "internal_error",
                "Please retry once. If the problem continues, check the server logs."
            )
        }
    )


@app.on_event("startup")
def startup_event():
    ensure_worker_running()
    # Seed Super Admin
    db = SessionLocal()
    try:
        admin_email = "suraj.sonnar@ikf.co.in"
        admin = db.query(models.User).filter(models.User.email == admin_email).first()
        if not admin:
            admin = models.User(
                email=admin_email,
                is_approved=True,
                role="admin",
                hashed_password=auth.get_password_hash("admin123") # Default password, should be changed
            )
            db.add(admin)
            db.commit()
            logger.info(f"Seeded super-admin: {admin_email}")
        else:
            # Ensure existing suraj is admin and approved
            admin.is_approved = True
            admin.role = "admin"
            db.commit()
    except Exception as e:
        logger.error(f"Failed to seed admin: {e}")
    finally:
        db.close()


@app.on_event("shutdown")
def shutdown_event():
    worker_shutdown_event.set()

# --- Constants & Helpers ---

COLUMN_MAPPING = {
    "Name": ["name", "full name", "recipient", "client name", "customer name", "user", "contact"],
    "Email": ["email", "email address", "mail", "mail id", "recipient email", "to"],
    "Amount": ["amount", "invoice amount", "total", "bill amount", "price", "value", "balance"],
    "Due Date": ["due date", "date", "payment date", "deadline", "expiry", "schedule"]
}

DEFAULT_HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
        .wrapper { width: 100%; border-collapse: collapse; table-layout: fixed; background-color: #f8fafc; padding: 40px 0; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
        .content { padding: 40px 30px; color: #1e293b; line-height: 1.6; font-size: 16px; border-collapse: collapse; }
        .content table { width: 100% !important; border-collapse: collapse; }
        .content td { padding: 8px 0; }
        .footer { padding: 30px; text-align: center; background-color: #f1f5f9; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0; }
        .highlight { color: #4f46e5; font-weight: 700; }
        @media only screen and (max-width: 600px) {
            .container { width: 100% !important; border-radius: 0 !important; }
            .content { padding: 30px 20px !important; }
        }
    </style>
</head>
<body>
    <table class="wrapper">
        <tr>
            <td>
                <div class="container">
                    <div class="content">
                        {{MESSAGE_BODY}}
                    </div>
                    <div class="footer">
                        <p style="margin: 0; font-weight: 700; color: #0f172a; font-size: 15px;">I Knowledge Factory (IKF)</p>
                        <p style="margin: 5px 0 0 0;">craft | care | amplify</p>
                        <p style="margin-top: 20px; opacity: 0.6; font-size: 11px;">© 2026 I Knowledge Factory Pvt. Ltd. All rights reserved.</p>
                    </div>
                </div>
            </td>
        </tr>
    </table>
</body>
</html>
"""

SAMPLE_MESSAGE = """<p>Dear <span class="highlight">{{Name}}</span>,</p>

<p>I hope this message finds you well.</p>

<p>This is a professional update regarding the outstanding amount of <span class="highlight">{{Amount}}</span> associated with your account.</p>

<p>According to our records, the scheduled date was <strong>{{Date}}</strong>. We would appreciate it if you could review this and process any necessary actions at your earliest convenience.</p>

<p>Thank you for your partnership and cooperation.</p>

<p>Best regards,<br>
<strong>The Team</strong></p>"""

DEFAULT_HTML_TEMPLATE_CREATIVE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Outfit', 'Inter', -apple-system, sans-serif; }
        .wrapper { width: 100%; border-collapse: collapse; table-layout: fixed; background-color: #f3f4f6; padding: 40px 0; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
        .content { padding: 50px 35px; color: #1e293b; line-height: 1.7; font-size: 17px; }
        .action-box { background-color: #f8fafc; border-radius: 16px; padding: 25px; margin: 25px 0; border-left: 6px solid #6366f1; border: 1px solid #e2e8f0; border-left-width: 6px; }
        .footer { padding: 40px; text-align: center; background-color: #0f172a; color: #94a3b8; font-size: 13px; }
        .highlight { color: #6366f1; font-weight: 800; }
        @media only screen and (max-width: 600px) {
            .container { width: 100% !important; border-radius: 0 !important; }
            .content { padding: 30px 20px !important; }
        }
    </style>
</head>
<body>
    <table class="wrapper">
        <tr>
            <td>
                <div class="container">
                    <div class="content">
                        {{MESSAGE_BODY}}
                    </div>
                    <div class="footer">
                        <p style="color: #ffffff; font-weight: 700; font-size: 17px; margin-bottom: 8px;">I Knowledge Factory (IKF)</p>
                        <p>craft | care | amplify</p>
                        <p style="margin-top: 20px; opacity: 0.5; font-size: 11px;">© 2026 I Knowledge Factory Pvt. Ltd. All rights reserved.</p>
                    </div>
                </div>
            </td>
        </tr>
    </table>
</body>
</html>
"""

SAMPLE_MESSAGE_CREATIVE = """<h2 style="color: #111827; margin-top: 0;">Hi <span class="highlight">{{Name}}</span>! 👋</h2>

<p>I hope you're having a productive and wonderful week.</p>

<div class="action-box">
    <p style="margin: 0; font-weight: 700; color: #374151;">A quick update regarding your account:</p>
    <p style="font-size: 28px; margin: 12px 0; color: #8b5cf6; font-weight: 900;">{{Amount}}</p>
    <p style="margin: 0; font-size: 14px; color: #6b7280;">Action scheduled for: <strong>{{Date}}</strong></p>
</div>

<p>We're here to help if you have any questions or need further assistance. Simply hit reply to this email, and our team will be right with you.</p>

<p>Thank you for being a valued partner!</p>

<p>Warm regards,<br>
<span style="color: #8b5cf6; font-weight: 700;">IKF Digital Support</span></p>"""

GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state"


def _get_gmail_client_config(settings, redirect_uri: str) -> dict:
    """Return a Flow-compatible client_config dict.

    Priority: DB-stored credentials → credentials.json file.
    """
    if settings and settings.gmail_client_id and settings.gmail_client_secret:
        return {
            "web": {
                "client_id": settings.gmail_client_id,
                "client_secret": settings.gmail_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [redirect_uri],
            }
        }
    if CREDENTIALS_PATH.exists():
        raw = json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))
        # credentials.json can be "installed" or "web" type
        creds = raw.get("web") or raw.get("installed") or {}
        return {
            "web": {
                "client_id": creds.get("client_id", ""),
                "client_secret": creds.get("client_secret", ""),
                "auth_uri": creds.get("auth_uri", "https://accounts.google.com/o/oauth2/auth"),
                "token_uri": creds.get("token_uri", "https://oauth2.googleapis.com/token"),
                "redirect_uris": [redirect_uri],
            }
        }
    raise HTTPException(
        status_code=400,
        detail="Gmail credentials not configured. Save your Client ID and Secret in Settings, or place credentials.json in the app directory."
    )
PNG_LOGO_PATH = str(LOGO_PATH)

KNOWLEDGE_FACTORY_LOGO_SVG = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 320" role="img" aria-labelledby="title desc">
  <title id="title">Knowledge Factory</title>
  <desc id="desc">Knowledge Factory brand logo</desc>
  <rect width="900" height="320" fill="#ffffff"/>
  <path d="M20 20h160v80h-18V38H38v244h124v-18h18v36H20z" fill="#dba62b"/>
  <circle cx="93" cy="78" r="24" fill="#2963a0"/>
  <path d="M60 125l72-8v130h26v23H60v-23h22v-90H60z" fill="#2963a0"/>
  <text x="210" y="152" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="700" fill="#2963a0" letter-spacing="1">KNOWLEDGE</text>
  <text x="210" y="230" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700" fill="#2963a0" letter-spacing="1">FACTORY</text>
  <text x="330" y="282" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="400" fill="#2963a0">craft | care | amplify</text>
</svg>
""".strip()

FALLBACK_LOGO_DATA_URI = f"data:image/svg+xml;utf8,{quote(KNOWLEDGE_FACTORY_LOGO_SVG)}"


def get_logo_data_uri() -> str:
    if os.path.exists(PNG_LOGO_PATH):
        with open(PNG_LOGO_PATH, "rb") as logo_file:
            encoded_logo = base64.b64encode(logo_file.read()).decode("ascii")
        return f"data:image/png;base64,{encoded_logo}"
    return FALLBACK_LOGO_DATA_URI


KNOWLEDGE_FACTORY_LOGO_DATA_URI = get_logo_data_uri()
DEFAULT_HTML_TEMPLATE = DEFAULT_HTML_TEMPLATE.replace("__LOGO_SRC__", KNOWLEDGE_FACTORY_LOGO_DATA_URI)
DEFAULT_HTML_TEMPLATE_CREATIVE = DEFAULT_HTML_TEMPLATE_CREATIVE.replace("__LOGO_SRC__", KNOWLEDGE_FACTORY_LOGO_DATA_URI)



# --- Auth Endpoints ---

@app.post("/api/auth/signup", response_model=schemas.UserResponse)
def signup(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user_in.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user = models.User(
        email=user_in.email,
        hashed_password=auth.get_password_hash(user_in.password),
        is_approved=False,
        role="user"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@app.post("/api/auth/login", response_model=schemas.Token)
def login(user_in: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == user_in.email).first()
    if not user or not auth.verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=401, 
            detail=error_detail("Invalid email or password", "auth_failed", "Double-check your credentials.")
        )
    
    access_token = auth.create_access_token(data={"sub": user.email})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }

@app.get("/api/auth/me", response_model=schemas.UserResponse)
def read_users_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user

@app.post("/api/auth/google", response_model=schemas.Token)
async def google_login(payload: schemas.GoogleLoginRequest, db: Session = Depends(get_db)):
    import httpx
    
    # Verify token with google
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={payload.credential}")
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail="Invalid Google token")
            data = resp.json()
            email = data.get("email")
    except Exception as e:
        logger.error(f"Google Token Verification Failed: {e}")
        raise HTTPException(status_code=400, detail="Google authentication failed")
        
    if not email:
        raise HTTPException(status_code=400, detail="Google token missing email")

    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        # Auto-provision
        user = models.User(
            email=email,
            hashed_password=None,
            is_approved=False, # Still needs admin approval
            role="user"
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    access_token = auth.create_access_token(data={"sub": user.email})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }


# --- Public Config Endpoint ---

@app.get("/api/config", response_model=schemas.PublicConfig)
def get_public_config():
    """Returns non-sensitive public configuration the frontend needs at runtime."""
    return {
        "google_client_id": os.getenv("GOOGLE_CLIENT_ID") or os.getenv("VITE_GOOGLE_CLIENT_ID") or None,
    }


# --- Forgot / Reset Password ---

def _send_reset_email(to_email: str, reset_url: str, db: Session):
    """Try to send a password-reset email via the configured provider."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    html_body = f"""
    <html><body style="font-family:sans-serif;color:#0f172a;padding:24px">
      <h2 style="color:#1666d3">IKF MailMerge Studio — Password Reset</h2>
      <p>We received a request to reset your password. Click the button below to choose a new password.</p>
      <p style="margin:28px 0">
        <a href="{reset_url}"
           style="background:#1666d3;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">
          Reset My Password
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">
        This link expires in <strong>30 minutes</strong>.<br>
        If you didn't request a reset, you can safely ignore this email.
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
      <p style="color:#94a3b8;font-size:12px">IKF — I Knowledge Factory Pvt. Ltd. · Internal Platform</p>
    </body></html>
    """

    settings = db.query(models.SystemSettings).first()

    # 1. Try SMTP from system settings
    smtp_host = smtp_port = smtp_user = smtp_password = None
    if settings:
        smtp_host = settings.smtp_host
        smtp_port = settings.smtp_port
        smtp_user = settings.smtp_user
        smtp_password_enc = settings.smtp_password
        if smtp_password_enc:
            try:
                from security import decrypt_secret
                smtp_password = decrypt_secret(smtp_password_enc)
            except Exception:
                smtp_password = smtp_password_enc

    # 2. Try multi-account SMTP — pick the active one
    if not (smtp_host and smtp_user and smtp_password):
        acct = db.query(models.SmtpAccount).filter(models.SmtpAccount.is_active == True).first()
        if acct:
            smtp_host = acct.smtp_host
            smtp_port = acct.smtp_port
            smtp_user = acct.smtp_user
            try:
                from security import decrypt_secret
                smtp_password = decrypt_secret(acct.smtp_password)
            except Exception:
                smtp_password = acct.smtp_password

    if smtp_host and smtp_user and smtp_password:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Reset Your IKF MailMerge Password"
        msg["From"] = smtp_user
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))
        port = int(smtp_port or 465)
        try:
            if port == 465:
                with smtplib.SMTP_SSL(smtp_host, port, timeout=10) as server:
                    server.login(smtp_user, smtp_password)
                    server.sendmail(smtp_user, to_email, msg.as_string())
            else:
                with smtplib.SMTP(smtp_host, port, timeout=10) as server:
                    server.starttls()
                    server.login(smtp_user, smtp_password)
                    server.sendmail(smtp_user, to_email, msg.as_string())
            return True
        except Exception as e:
            logger.error("Password reset email SMTP error: %s", e)

    # 3. Try Gmail API token
    try:
        from gmail_service import GmailService
        svc = GmailService()
        svc.send_email(to_email=to_email, subject="Reset Your IKF MailMerge Password", body=html_body)
        return True
    except Exception as e:
        logger.error("Password reset email Gmail error: %s", e)

    return False


@app.post("/api/auth/forgot-password")
def forgot_password(payload: schemas.ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """
    Always returns 200 to avoid user-enumeration. Sends reset link only if email exists
    and has a hashed_password (Google-only accounts cannot use password reset).
    """
    user = db.query(models.User).filter(models.User.email == payload.email).first()

    if user and user.hashed_password:
        import secrets as _secrets
        # Expire any previous unused tokens for this email
        db.query(models.PasswordResetToken).filter(
            models.PasswordResetToken.email == payload.email,
            models.PasswordResetToken.used == False,
        ).delete()

        token = _secrets.token_urlsafe(32)
        expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=30)
        reset_record = models.PasswordResetToken(
            email=payload.email,
            token=token,
            expires_at=expires_at,
        )
        db.add(reset_record)
        db.commit()

        base_url = str(request.base_url).rstrip("/")
        reset_url = f"{base_url}/auth?reset_token={token}"
        sent = _send_reset_email(payload.email, reset_url, db)
        if not sent:
            logger.warning("Password reset email could not be sent for %s. Reset URL: %s", payload.email, reset_url)

    return {"message": "If that email exists in our system, a reset link has been sent."}


@app.post("/api/auth/reset-password")
def reset_password(payload: schemas.ResetPasswordRequest, db: Session = Depends(get_db)):
    record = db.query(models.PasswordResetToken).filter(
        models.PasswordResetToken.token == payload.token,
        models.PasswordResetToken.used == False,
    ).first()

    if not record:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    if datetime.datetime.utcnow() > record.expires_at:
        raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")

    user = db.query(models.User).filter(models.User.email == record.email).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found.")

    user.hashed_password = auth.get_password_hash(payload.new_password)
    record.used = True
    db.commit()

    return {"message": "Password updated successfully. You can now sign in."}


# --- Admin User Management Endpoints ---

@app.get("/api/admin/users", response_model=list[schemas.UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_active_admin)
):
    return db.query(models.User).order_by(models.User.created_at.asc()).all()

@app.post("/api/admin/users/{user_id}/approve", response_model=schemas.UserResponse)
def approve_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_active_admin)
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_approved = True
    log_audit(db, "user.approved", "user", f"Approved user {user.email}", str(user_id))
    db.commit()
    db.refresh(user)
    return user

@app.post("/api/admin/users/{user_id}/revoke", response_model=schemas.UserResponse)
def revoke_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_active_admin)
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Cannot revoke your own access")
    user.is_approved = False
    log_audit(db, "user.revoked", "user", f"Revoked user {user.email}", str(user_id))
    db.commit()
    db.refresh(user)
    return user

@app.post("/api/admin/users/{user_id}/promote", response_model=schemas.UserResponse)
def promote_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_active_admin)
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = "admin"
    user.is_approved = True
    log_audit(db, "user.promoted", "user", f"Promoted {user.email} to admin", str(user_id))
    db.commit()
    db.refresh(user)
    return user

@app.post("/api/admin/users/{user_id}/demote", response_model=schemas.UserResponse)
def demote_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_active_admin)
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Cannot demote yourself")
    user.role = "user"
    log_audit(db, "user.demoted", "user", f"Demoted {user.email} to user", str(user_id))
    db.commit()
    db.refresh(user)
    return user

@app.delete("/api/admin/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_active_admin)
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    # Disassociate records instead of cascading delete
    db.query(models.BatchJob).filter(models.BatchJob.user_id == user_id).update({"user_id": None})
    db.query(models.InvoiceData).filter(models.InvoiceData.user_id == user_id).update({"user_id": None})
    db.query(models.SmtpAccount).filter(models.SmtpAccount.user_id == user_id).update({"user_id": None})
    db.query(models.BatchAttachment).filter(models.BatchAttachment.user_id == user_id).update({"user_id": None})
    log_audit(db, "user.deleted", "user", f"Deleted user {user.email}", str(user_id))
    db.delete(user)
    db.commit()
    return {"ok": True}


def build_gmail_redirect_uri(request: Request) -> str:
    base_url = str(request.base_url).rstrip("/")
    return f"{base_url}/api/gmail/callback"


def get_legacy_smtp_config(settings: Optional[models.SystemSettings]) -> Optional[dict]:
    if not settings:
        return None

    required_fields = {
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
        "smtp_user": settings.smtp_user,
        "smtp_password": settings.smtp_password,
    }
    if any(not value for value in required_fields.values()):
        return None

    return {
        "display_name": settings.smtp_user or "Primary SMTP",
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
        "smtp_user": settings.smtp_user,
        "smtp_password": encrypt_secret(settings.smtp_password) if settings.smtp_password else None,
    }


def sync_legacy_smtp_fields(settings: models.SystemSettings, account: Optional[models.SmtpAccount]):
    if not settings:
        return

    if account:
        settings.smtp_host = account.smtp_host
        settings.smtp_port = account.smtp_port
        settings.smtp_user = account.smtp_user
        settings.smtp_password = account.smtp_password
    else:
        settings.smtp_user = None
        settings.smtp_password = None


def validate_smtp_account_fields(
    display_name: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: Optional[str],
    require_password: bool = True,
):
    if not (display_name or "").strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "SMTP account name is required.",
                "smtp_account_name_required",
                "Add a short label like Gmail Marketing or Finance SMTP."
            )
        )

    if not (smtp_host or "").strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "SMTP host is required.",
                "smtp_host_required",
                "Enter the mail server host, for example smtp.gmail.com."
            )
        )

    if not smtp_port or int(smtp_port) <= 0 or int(smtp_port) > 65535:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "SMTP port is invalid.",
                "smtp_port_invalid",
                "Use a valid SMTP port such as 465 or 587."
            )
        )

    if not (smtp_user or "").strip() or not is_valid_email_address(str(smtp_user)):
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "SMTP login email address is invalid.",
                "smtp_user_invalid",
                "Use the real email address for the SMTP account."
            )
        )

    if require_password and not (smtp_password or "").strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "SMTP password is required.",
                "smtp_password_required",
                "Use the account password or app password for this SMTP account."
            )
        )


def ensure_single_active_smtp_account(db: Session, account_id: int):
    db.query(models.SmtpAccount).update({models.SmtpAccount.is_active: False}, synchronize_session=False)
    target = db.query(models.SmtpAccount).filter(models.SmtpAccount.id == account_id).first()
    if target:
        target.is_active = True
    return target


def import_legacy_smtp_account_if_needed(db: Session, settings: Optional[models.SystemSettings]) -> Optional[models.SmtpAccount]:
    has_accounts = db.query(models.SmtpAccount).first()
    if has_accounts:
        return None

    legacy_config = get_legacy_smtp_config(settings)
    if not legacy_config:
        return None

    imported_account = models.SmtpAccount(
        display_name=f"{legacy_config['smtp_user']} (Imported)",
        smtp_host=legacy_config["smtp_host"],
        smtp_port=legacy_config["smtp_port"],
        smtp_user=legacy_config["smtp_user"],
        smtp_password=encrypt_secret(legacy_config["smtp_password"]),
        is_active=True,
    )
    db.add(imported_account)
    db.commit()
    db.refresh(imported_account)
    return imported_account


def get_active_smtp_account(db: Session, settings: Optional[models.SystemSettings], auto_import_legacy: bool = True) -> Optional[models.SmtpAccount]:
    if auto_import_legacy:
        imported_account = import_legacy_smtp_account_if_needed(db, settings)
        if imported_account:
            return imported_account

    active_account = db.query(models.SmtpAccount).filter(models.SmtpAccount.is_active.is_(True)).first()
    if active_account:
        return active_account

    fallback_account = db.query(models.SmtpAccount).order_by(models.SmtpAccount.id.asc()).first()
    if fallback_account:
        fallback_account.is_active = True
        db.commit()
        db.refresh(fallback_account)
        return fallback_account

    return None


def build_batch_delivery_snapshot(settings: Optional[models.SystemSettings], db: Session) -> dict:
    """Capture provider/SMTP details at queue time for Status page diagnostics."""
    if not settings:
        return {}

    provider = (settings.active_provider or "").strip() or None
    snapshot = {"provider": provider}
    if provider in {"SMTP", "GMAIL_SMTP"}:
        active = get_active_smtp_account(db, settings)
        if active:
            snapshot["smtp"] = {
                "display_name": active.display_name,
                "host": active.smtp_host,
                "port": active.smtp_port,
                "user": active.smtp_user,
            }
    elif provider == "BREVO":
        snapshot["brevo"] = {
            "sender_name": settings.brevo_sender_name,
            "sender_email": settings.brevo_sender_email,
        }
    elif provider == "GMAIL":
        snapshot["gmail"] = {"oauth": True}
    return snapshot


def validate_email_provider(settings: models.SystemSettings, db: Session):
    if not settings:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "System settings are missing.",
                "settings_missing",
                "Open Configuration and save your email provider settings first."
            )
        )

    if settings.active_provider == "BREVO":
        if not settings.brevo_api_key:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "Brevo API key is missing.",
                    "brevo_key_missing",
                    "Open Configuration, select Brevo, add the API key, and save."
            )
        )
    elif settings.active_provider in {"GMAIL_SMTP", "SMTP"}:
        active_account = get_active_smtp_account(db, settings)
        if not active_account:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "No active SMTP account is available.",
                    "smtp_account_missing",
                    "Open Configuration, add at least one SMTP account, and set it active."
                )
            )
    else:
        if not os.path.exists(TOKEN_PATH):
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "Gmail is not authenticated.",
                    "gmail_not_connected",
                    "Open Configuration and complete the Gmail connection flow first."
                )
            )


def validate_mapping(mapping_dict: dict):
    if not isinstance(mapping_dict, dict):
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Column mapping is invalid.",
                "mapping_invalid",
                "Refresh the page, remap your columns, and try again."
            )
        )

    email_column = str(mapping_dict.get("email", "")).strip()
    if not email_column:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "The Email field must be mapped before continuing.",
                "email_mapping_required",
                "Map the spreadsheet column that contains recipient email addresses."
            )
        )


def normalize_email_list(raw_email: str) -> list[str]:
    return [email.strip() for email in str(raw_email).split(",") if email.strip()]


def is_valid_email_address(value: str) -> bool:
    try:
        from email_validator import validate_email, EmailNotValidError  # bundled with pydantic[email]
        validate_email(value.strip(), check_deliverability=False)
        return True
    except EmailNotValidError:
        return False


def validate_send_payload(batch_id: str, subject: Optional[str], content: Optional[str]):
    if not batch_id:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Batch ID is missing.",
                "batch_id_missing",
                "Upload and process a file before sending emails."
            )
        )

    if not (subject or "").strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Subject line cannot be empty.",
                "subject_required",
                "Add a subject line before sending or testing the email."
            )
        )

    if not (content or "").strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Email content cannot be empty.",
                "content_required",
                "Write a message body before sending or testing the email."
            )
        )


def resolve_template_and_wrapper(
    settings: models.SystemSettings,
    template_type: Optional[str],
    custom_subject: Optional[str],
    custom_html: Optional[str],
):
    effective_template_type = template_type or "PROFESSIONAL"
    if effective_template_type == "CREATIVE":
        base_subject = custom_subject or settings.email_template_creative_subject or "An update for you!"
        base_raw_message = custom_html or settings.email_template_creative_html or SAMPLE_MESSAGE_CREATIVE
        wrapper_template = DEFAULT_HTML_TEMPLATE_CREATIVE
    else:
        base_subject = custom_subject or settings.email_template_subject or "Professional Update"
        base_raw_message = custom_html or settings.email_template_html or SAMPLE_MESSAGE
        wrapper_template = DEFAULT_HTML_TEMPLATE
    return effective_template_type, base_subject, base_raw_message, wrapper_template


def build_provider_service(settings: models.SystemSettings, db: Session):
    from gmail_service import GmailService
    from brevo_service import BrevoService
    from smtp_service import SmtpService

    validate_email_provider(settings, db)
    active_smtp_account = get_active_smtp_account(db, settings) if settings.active_provider in {"GMAIL_SMTP", "SMTP"} else None

    if settings.active_provider == "BREVO":
        return BrevoService(api_key=settings.brevo_api_key)
    if settings.active_provider in {"GMAIL_SMTP", "SMTP"}:
        return SmtpService(
            host=active_smtp_account.smtp_host,
            port=active_smtp_account.smtp_port,
            user=active_smtp_account.smtp_user,
            password=decrypt_secret(active_smtp_account.smtp_password),
        )
    return GmailService()


def send_record(
    db: Session,
    record: models.InvoiceData,
    settings: models.SystemSettings,
    service,
    base_subject: str,
    base_raw_message: str,
    wrapper_template: str,
    payload_is_html: bool,
    attachments: Optional[list[dict]] = None,
):
    context = get_row_context(record)
    subject = substitute_variables(base_subject, context)
    content = substitute_variables(base_raw_message, context)

    content_lower = content.lower()
    if payload_is_html and (content_lower.startswith("<!doctype") or "<html" in content_lower):
        body = content
    else:
        body = wrapper_template.replace("{{MESSAGE_BODY}}", content)

    recipients = [e.strip() for e in record.email_address.split(",") if e.strip()]
    if not recipients:
        record.status = "failed"
        record.error_message = "No valid recipient email addresses were found for this row."
        db.commit()
        return {"ok": False, "sent": 0, "failed": 1, "errors": [record.error_message]}

    success_count = 0
    errors = []
    for email in recipients:
        attempt = 0
        sent_successfully = False
        last_err = ""
        while attempt < 3 and not sent_successfully:
            try:
                if settings.active_provider == "BREVO":
                    success, result = service.send_email(
                        to_email=email,
                        subject=subject,
                        html_content=body,
                        sender_name=settings.brevo_sender_name,
                        sender_email=settings.brevo_sender_email,
                        attachments=attachments or [],
                    )
                elif settings.active_provider in {"GMAIL_SMTP", "SMTP"}:
                    success, result = service.send_email(to_email=email, subject=subject, html_content=body, attachments=attachments or [])
                else:
                    success, result = service.send_email(email, subject, body, attachments=attachments or [])

                if success:
                    sent_successfully = True
                    success_count += 1
                else:
                    last_err = str(result)
                    attempt += 1
                    time.sleep(1)
            except Exception as ex:
                last_err = str(ex)
                attempt += 1
                time.sleep(1)

        if not sent_successfully:
            errors.append(f"{email}: {last_err}")

    if success_count == len(recipients):
        record.status = "success"
        record.sent_at = datetime.datetime.utcnow()
        record.error_message = None
    elif success_count > 0:
        record.status = "partial"
        record.error_message = f"Partial success ({success_count}/{len(recipients)}). Errors: {'; '.join(errors)}"
    else:
        record.status = "failed"
        record.error_message = "; ".join(errors) if errors else "Unknown provider error"

    db.commit()
    return {"ok": success_count == len(recipients), "sent": success_count, "failed": len(recipients) - success_count, "errors": errors}


def validate_template_fields(name: Optional[str], subject: Optional[str], html: Optional[str]):
    if name is not None and not name.strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Template name cannot be empty.",
                "template_name_required",
                "Enter a short template name before saving."
            )
        )

    if subject is not None and not subject.strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Template subject cannot be empty.",
                "template_subject_required",
                "Add a subject line before saving the template."
            )
        )

    if html is not None and not html.strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Template content cannot be empty.",
                "template_content_required",
                "Add some email content before saving the template."
            )
        )


def log_audit(db: Session, action: str, entity_type: str, summary: str, entity_id: Optional[str] = None, metadata: Optional[dict] = None):
    db.add(
        models.AuditLog(
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            summary=summary,
            metadata_json=json.dumps(metadata or {}),
        )
    )


def get_batch_job(db: Session, batch_id: str, user_id: Optional[int] = None) -> Optional[models.BatchJob]:
    query = db.query(models.BatchJob).filter(models.BatchJob.batch_id == batch_id)
    if user_id:
        query = query.filter(models.BatchJob.user_id == user_id)
    return query.first()


def ensure_batch_job(db: Session, batch_id: str, source_filename: Optional[str] = None, user_id: Optional[int] = None) -> models.BatchJob:
    batch = get_batch_job(db, batch_id)
    if batch:
        if source_filename and not batch.source_filename:
            batch.source_filename = source_filename
        if user_id and not batch.user_id:
            batch.user_id = user_id
            db.commit()
        return batch

    batch = models.BatchJob(batch_id=batch_id, source_filename=source_filename, status="draft", user_id=user_id)
    db.add(batch)
    db.flush()
    return batch


def get_row_context(record: models.InvoiceData) -> dict:
    # Load raw column data from the JSON field
    context = json.loads(record.row_data) if record.row_data else {}
    
    # Senior QA: Smart Alias System
    # We provide standard keys that users expect, regardless of CSV column naming.
    # Map high-priority fields to multiple standard aliases.
    aliases = {
        "Name": record.recipient_name,
        "Recipient": record.recipient_name,
        "Client Name": record.recipient_name,
        "Recipient Name": record.recipient_name,
        "Email": record.email_address,
        "Recipient Email": record.email_address,
        "Amount": record.invoice_amount,
        "Value": record.invoice_amount,
        "Pending Amount": record.invoice_amount,
        "Invoice Amount": record.invoice_amount,
        "Date": record.due_date,
        "Due Date": record.due_date,
        "Scheduled Date": record.due_date
    }
    
    # Priority: Original Columns > System Aliases
    # This preserves any custom column naming while providing smart defaults.
    for k, v in aliases.items():
        if k not in context:
            context[k] = v
            
    # Strip time portion from any datetime string (not just midnight).
    # Handles: "2024-01-15T14:30:00", "2024-01-15 00:00:00", "2024-01-15T00:00:00.000Z"
    for key in list(context.keys()):
        val = context[key]
        if not isinstance(val, str) or not val:
            continue
        ts_match = re.match(r"^(\d{4})-(\d{2})-(\d{2})[T ]", val)
        if ts_match:
            try:
                context[key] = datetime.datetime(
                    int(ts_match.group(1)), int(ts_match.group(2)), int(ts_match.group(3))
                ).strftime("%d/%m/%Y")
            except Exception:
                context[key] = val[:10]  # fall back to just the date part

    return context


def extract_template_variables(content: str) -> list[str]:
    return sorted({match.strip() for match in re.findall(r"\{\{([^{}\n]+?)\}\}", content or "") if match.strip()})


def evaluate_batch_validation(db: Session, batch_id: str, subject: str, content: str) -> dict:
    records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id).all()
    if not records:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "Batch not found.",
                "batch_not_found",
                "Upload and process a file before validating the send."
            )
        )

    recipient_counter: dict[str, int] = {}
    duplicate_recipients: set[str] = set()
    invalid_rows = 0
    missing_name_rows = 0

    for record in records:
        recipients = normalize_email_list(record.email_address)
        if not recipients or not all(is_valid_email_address(item) for item in recipients):
            invalid_rows += 1
        if not (record.recipient_name or "").strip():
            missing_name_rows += 1
        for recipient in recipients:
            normalized = recipient.lower()
            recipient_counter[normalized] = recipient_counter.get(normalized, 0) + 1
            if recipient_counter[normalized] > 1:
                duplicate_recipients.add(recipient)

    variables = extract_template_variables(subject) + extract_template_variables(content)
    sample_context = get_row_context(records[0])
    unresolved_variables = [variable for variable in sorted(set(variables)) if substitute_variables(f"{{{{{variable}}}}}", sample_context) == f"{{{{{variable}}}}}"]

    issues = []
    if duplicate_recipients:
        issues.append(f"{len(duplicate_recipients)} duplicate recipient email(s) detected.")
    if unresolved_variables:
        issues.append(f"Unresolved variables found: {', '.join(unresolved_variables)}.")
    if invalid_rows:
        issues.append(f"{invalid_rows} row(s) contain invalid or missing email addresses.")
    if missing_name_rows:
        issues.append(f"{missing_name_rows} row(s) are missing recipient names.")

    email_count = sum(len(normalize_email_list(r.email_address)) for r in records)

    return {
        "ok_to_send": not invalid_rows,  # unresolved variables are warnings only, not blockers
        "record_count": len(records),
        "email_count": email_count,
        "duplicate_recipients": sorted(duplicate_recipients),
        "duplicate_count": len(duplicate_recipients),
        "unresolved_variables": unresolved_variables,
        "invalid_rows": invalid_rows,
        "missing_name_rows": missing_name_rows,
        "issues": issues,
        "total": email_count
    }


def build_batch_stats(db: Session, batch_id: str) -> dict:
    records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id).all()
    
    total = 0
    success = 0
    failed = 0
    partial_count = 0
    pending = 0

    for record in records:
        emails = normalize_email_list(record.email_address)
        num_emails = len(emails) or 1 # Fallback to 1 if empty to show missing email error
        total += num_emails

        if record.status == "success":
            success += num_emails
        elif record.status == "failed":
            failed += num_emails
        elif record.status == "pending":
            pending += num_emails
        elif record.status == "partial":
            partial_count += 1
            # Smart Parsing: Extract "X/Y" from "Partial success (X/Y)"
            try:
                import re
                match = re.search(r"\((\d+)/(\d+)\)", record.error_message or "")
                if match:
                    s_val = int(match.group(1))
                    f_val = int(match.group(2)) - s_val
                    success += s_val
                    failed += max(0, f_val)
                else:
                    # Fallback if parsing fails: assume half success
                    success += num_emails // 2
                    failed += num_emails - (num_emails // 2)
            except Exception:
                success += 1
                failed += max(0, num_emails - 1)

    completion_rate = round((success / total) * 100, 2) if total else 0
    
    logger.info(f"BuildStats for {batch_id}: TotalEmails={total}, Success={success}, Failed={failed}, Pending={pending}")
    
    return {
        "total": total,
        "success": success,
        "failed": failed,
        "partial": partial_count,
        "pending": pending,
        "completion_rate": completion_rate,
    }


def update_job_validation_summary(db: Session, batch: models.BatchJob):
    if not batch.custom_subject or not batch.custom_html:
        return
    batch.validation_summary = json.dumps(evaluate_batch_validation(db, batch.batch_id, batch.custom_subject, batch.custom_html))


def parse_batch_metadata(batch: Optional[models.BatchJob]) -> dict:
    if not batch or not batch.validation_summary:
        return {}
    try:
        payload = json.loads(batch.validation_summary)
        if isinstance(payload, dict):
            return payload
    except Exception:
        return {}
    return {}


def persist_batch_metadata(
    batch: models.BatchJob,
    validation: dict,
    dispatch_plan: Optional[dict],
    delivery_snapshot: Optional[dict] = None,
):
    metadata = {"validation": validation}
    if dispatch_plan:
        metadata["dispatch_plan"] = dispatch_plan
    if delivery_snapshot:
        metadata["delivery"] = delivery_snapshot
    batch.validation_summary = json.dumps(metadata)


def build_dispatch_plan(
    now_utc: datetime.datetime,
    pending_total: int,
    pacing: schemas.CampaignPacingPayload,
) -> dict:
    if not pacing.start_at or not pacing.end_at:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Start and end date/time are required for campaign pacing.",
                "pacing_missing_window",
                "Pick both start and end times in Dispatch controls."
            )
        )
    if pacing.end_at <= pacing.start_at:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "End date/time must be after start date/time.",
                "pacing_invalid_window",
                "Set an end time that is later than start time."
            )
        )
    max_campaign_days = 45
    if (pacing.end_at - pacing.start_at).days > max_campaign_days:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Campaign window is too long.",
                "pacing_window_too_long",
                f"Keep campaign period within {max_campaign_days} days."
            )
        )
    slot_minutes = max(15, min(180, int(pacing.slot_minutes or 60)))
    min_per_slot = max(1, int(pacing.min_per_slot or 1))
    max_per_slot = max(min_per_slot, int(pacing.max_per_slot or min_per_slot))

    daily_start_hour = pacing.daily_start_hour if pacing.daily_start_hour is not None else 0
    daily_end_hour = pacing.daily_end_hour if pacing.daily_end_hour is not None else 23
    daily_start_hour = max(0, min(23, int(daily_start_hour)))
    daily_end_hour = max(0, min(23, int(daily_end_hour)))
    if daily_start_hour > daily_end_hour:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Daily start hour must be before end hour.",
                "pacing_invalid_daily_window",
                "Use a valid hour range like 9 to 17."
            )
        )

    def slot_allowed(dt: datetime.datetime) -> bool:
        if pacing.weekdays_only and dt.weekday() >= 5:
            return False
        hour = dt.hour
        return daily_start_hour <= hour <= daily_end_hour

    slots = []
    cursor = pacing.start_at
    while cursor <= pacing.end_at and len(slots) < 3000:
        if slot_allowed(cursor):
            slots.append(cursor)
        cursor = cursor + datetime.timedelta(minutes=slot_minutes)
    if not slots:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "No valid send slots in selected date/time window.",
                "pacing_no_slots",
                "Expand date range or adjust daily hours."
            )
        )

    remaining = pending_total
    total_slots = len(slots)
    required_avg = int((pending_total + total_slots - 1) / total_slots)
    effective_min = min_per_slot
    effective_max = max_per_slot
    if required_avg > effective_max:
        # Smart self-healing: auto-raise max so schedule can actually finish.
        effective_max = required_avg
    if effective_min > effective_max:
        effective_min = effective_max

    slot_items = []
    for idx, slot_at in enumerate(slots):
        if remaining <= 0:
            break
        slots_left = len(slots) - idx
        target_avg = int((remaining + slots_left - 1) / slots_left)
        reserve_min = max(0, (slots_left - 1) * effective_min)
        upper_bound = max(1, min(effective_max, remaining - reserve_min))
        lower_bound = min(effective_min, upper_bound)

        if pacing.randomize:
            low = min(lower_bound, target_avg)
            high = max(lower_bound, min(upper_bound, target_avg + max(5, int(target_avg * 0.2))))
            planned = random.randint(low, high)
        else:
            planned = min(upper_bound, max(lower_bound, target_avg))
        planned = min(planned, remaining)
        remaining -= planned
        slot_items.append({
            "index": idx + 1,
            "scheduled_for": slot_at.isoformat(),
            "count": planned,
            "status": "pending",
        })

    if remaining > 0:
        slot_items[-1]["count"] += remaining

    return {
        "enabled": True,
        "created_at": now_utc.isoformat(),
        "slot_minutes": slot_minutes,
        "min_per_slot": min_per_slot,
        "max_per_slot": max_per_slot,
        "effective_min_per_slot": effective_min,
        "effective_max_per_slot": effective_max,
        "randomize": bool(pacing.randomize),
        "weekdays_only": bool(pacing.weekdays_only),
        "daily_start_hour": daily_start_hour,
        "daily_end_hour": daily_end_hour,
        "total_planned": pending_total,
        "slots": slot_items,
    }


def get_next_due_dispatch_slot(dispatch_plan: Optional[dict], now_utc: datetime.datetime):
    if not dispatch_plan or not dispatch_plan.get("enabled"):
        return None, None
    slots = dispatch_plan.get("slots", [])
    if not isinstance(slots, list):
        return None, None
    for idx, slot in enumerate(slots):
        if slot.get("status") != "pending":
            continue
        when_raw = slot.get("scheduled_for")
        try:
            when = datetime.datetime.fromisoformat(str(when_raw))
        except Exception:
            continue
        if when <= now_utc:
            return idx, slot
        return None, slot
    return None, None


def claim_next_batch_job(db: Session) -> Optional[models.BatchJob]:
    """Atomically claim the next eligible job using an optimistic-lock pattern.

    We SELECT the candidate first, then immediately attempt an UPDATE that
    constrains on BOTH the primary key AND the expected status. If rowcount == 0
    another worker already claimed it, so we return None and let the poll loop
    retry on the next tick. This is safe for SQLite because each UPDATE is an
    atomic write inside its own implicit transaction.
    """
    now = datetime.datetime.utcnow()
    candidate = (
        db.query(models.BatchJob)
        .filter(models.BatchJob.status == "queued")
        .order_by(models.BatchJob.created_at.asc())
        .first()
    )
    if not candidate:
        candidate = (
            db.query(models.BatchJob)
            .filter(
                models.BatchJob.status == "scheduled",
                models.BatchJob.scheduled_for <= now,
            )
            .order_by(models.BatchJob.scheduled_for.asc(), models.BatchJob.created_at.asc())
            .first()
        )
    if not candidate:
        return None

    # Atomic claim: only succeeds if status hasn't changed since the SELECT above.
    rows_updated = (
        db.query(models.BatchJob)
        .filter(
            models.BatchJob.id == candidate.id,
            models.BatchJob.status == candidate.status,  # the concurrency guard
        )
        .update(
            {
                "status": "running",
                "started_at": candidate.started_at or now,
                "paused_at": None,
                "cancelled_at": None,
            },
            synchronize_session="fetch",
        )
    )
    db.commit()

    if rows_updated == 0:
        # Another worker claimed it between our SELECT and UPDATE.
        return None

    db.refresh(candidate)
    return candidate


def mark_pending_records_for_batch(db: Session, batch_id: str, status: str, message: str):
    records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id, models.InvoiceData.status == "pending").all()
    for record in records:
        record.status = status
        record.error_message = message
    db.commit()


def run_batch_worker():
    while not worker_shutdown_event.is_set():
        db = SessionLocal()
        try:
            job = claim_next_batch_job(db)
            if job:
                process_email_batch(job.batch_id, job.custom_subject, job.custom_html, job.is_html, job.template_type)
        except Exception as exc:
            logger.error("Batch worker loop error: %s", exc, exc_info=True)
        finally:
            db.close()
        worker_shutdown_event.wait(WORKER_POLL_SECONDS)


def ensure_worker_running():
    global worker_thread
    if worker_thread and worker_thread.is_alive():
        return
    worker_shutdown_event.clear()
    worker_thread = threading.Thread(target=run_batch_worker, name="ikf-batch-worker", daemon=True)
    worker_thread.start()


def heuristic_column_discovery(df: pd.DataFrame) -> dict:
    recommended = {"name": "", "email": "", "amount": "", "date": ""}
    try:
        columns = df.columns.tolist()
        sample = df.head(10).astype(str).apply(lambda x: x.str.strip())

        def slug(s: str) -> str:
            """Remove spaces/underscores/hyphens and lowercase for keyword matching."""
            return re.sub(r"[\s_\-]", "", str(s).lower())

        col_slugs = {col: slug(col) for col in columns}

        # ── 1. EMAIL ────────────────────────────────────────────────────────────
        # Priority: column name hint → content regex
        _email_hints = {"email", "mail", "emailaddress", "emailid", "emailladdress"}
        for col in columns:
            if any(h in col_slugs[col] for h in _email_hints):
                recommended["email"] = col
                break
        if not recommended["email"]:
            email_regex = r"[^@\s]+@[^@\s]+\.[^@\s]+"
            for col in columns:
                try:
                    if sample[col].apply(lambda x: bool(re.search(email_regex, str(x)))).any():
                        recommended["email"] = col
                        break
                except Exception:
                    continue

        # ── 2. DATE ─────────────────────────────────────────────────────────────
        _date_hints = {"date", "duedate", "due", "dob", "birthdate", "expiry",
                       "deadline", "schedule", "scheduleddate", "paymentdate", "invoicedate"}
        for col in columns:
            if col == recommended["email"]: continue
            if any(h in col_slugs[col] for h in _date_hints):
                recommended["date"] = col
                break
        if not recommended["date"]:
            _date_patterns = [
                r"\d{2,4}[-/\.]\d{1,2}[-/\.]\d{1,2}",   # 2024-01-15, 2024/01/15
                r"\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}",   # 15/01/2024, 01-15-2024
                r"\d{1,2}\s+\w{3,9}\s+\d{4}",            # 15 Jan 2024
            ]
            for col in columns:
                if col == recommended["email"]: continue
                try:
                    if sample[col].apply(
                        lambda x: any(re.search(p, str(x)) for p in _date_patterns)
                    ).any():
                        recommended["date"] = col
                        break
                except Exception:
                    continue

        # ── 3. AMOUNT ───────────────────────────────────────────────────────────
        _amount_hints = {"amount", "price", "total", "fee", "cost", "balance",
                         "outstanding", "payable", "receivable", "bill", "invoice",
                         "payment", "salary", "revenue", "profit", "tax", "discount",
                         "paid", "due", "charge", "value", "rate"}
        taken = {recommended["email"], recommended["date"]}
        for col in columns:
            if col in taken: continue
            if any(h in col_slugs[col] for h in _amount_hints):
                recommended["amount"] = col
                break
        if not recommended["amount"]:
            _skip_amount = {"id", "code", "phone", "mobile", "zip", "no", "num", "pin", "index"}
            for col in columns:
                if col in taken: continue
                if any(k in col_slugs[col] for k in _skip_amount): continue
                # Strip currency symbols before numeric check
                numeric_vals = pd.to_numeric(
                    sample[col].str.replace(r"[₹$€£,\s]", "", regex=True), errors="coerce"
                )
                if numeric_vals.notna().mean() > 0.5:
                    recommended["amount"] = col
                    break

        # ── 4. NAME ─────────────────────────────────────────────────────────────
        _name_hints = {"name", "client", "customer", "recipient", "person",
                       "company", "firm", "vendor", "buyer", "seller", "payee",
                       "payer", "fullname", "firstname", "lastname", "contactname"}
        taken = {recommended["email"], recommended["date"], recommended["amount"]}
        for col in columns:
            if col in taken: continue
            if any(h in col_slugs[col] for h in _name_hints):
                recommended["name"] = col
                break
        if not recommended["name"]:
            _skip_name = {"id", "code", "index", "status", "type", "no", "num", "pin"}
            for col in columns:
                if col in taken: continue
                if any(k in col_slugs[col] for k in _skip_name): continue
                is_name_like = sample[col].apply(
                    lambda x: 2 <= len(str(x)) <= 80
                    and not str(x).replace(".", "").replace("-", "").replace(",", "").isnumeric()
                )
                if is_name_like.mean() > 0.5:
                    recommended["name"] = col
                    break

    except Exception as e:
        logger.error(f"Heuristic discovery failed: {e}")
    return recommended


def substitute_variables(template: str, context: dict) -> str:
    if not template:
        return ""
    
    # Senior QA: Case-Insensitive & Space-Resilient Normalization
    def normalize_key(k):
        return re.sub(r'[\s_\-]', '', str(k).lower())

    lookup = {normalize_key(k): v for k, v in context.items()}

    def find_match(var_name):
        norm_var = normalize_key(var_name)
        return lookup.get(norm_var)

    # Smart Regex: Identify any {{variable}} regardless of internal spacing
    pattern = r"\{\{([^{}]+?)\}\}"
    
    def replace_match(match):
        raw_tag_content = match.group(1).strip()
        val = find_match(raw_tag_content)

        if val is not None:
            val_str = str(val).strip()

            # 1. Try date formatting first (before numeric check)
            formatted_date = _try_format_date(val_str)
            if formatted_date:
                return formatted_date

            # 2. Currency formatting — ONLY for amount-like column names
            if _is_amount_like_key(raw_tag_content):
                try:
                    num_str = re.sub(r"[,₹$€£\s]", "", val_str)
                    num = float(num_str)
                    if num >= 0:
                        return f"{num:,.2f}"
                except Exception:
                    pass

            return val_str

        return match.group(0)  # Keep unreplaced tags visible for auditing

    return re.sub(pattern, replace_match, template)


# --- API Routes ---

@app.get("/api")
def read_root():
    return {"status": "ok", "message": "IKF MailMerge Backend is running"}


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "app_env": APP_ENV,
        "port": APP_PORT,
        "version": API_VERSION,
        "timestamp": str(datetime.datetime.now())
    }


@app.get("/api/version")
def api_version():
    return {
        "ok": True,
        "version": API_VERSION,
        "features": {
            "selected_send": True,
            "campaign_pacing": True,
        }
    }

@app.get("/api/verify_session")
def verify_session():
    return {"ok": True, "message": "Backend version verified. You are running the LATEST code."}


@app.get("/api/ready")
def readiness_check():
    checks = {
        "data_dir_exists": DATA_DIR.exists(),
        "logo_exists": LOGO_PATH.exists(),
        "credentials_present": CREDENTIALS_PATH.exists(),
        "token_present": TOKEN_PATH.exists(),
        "dist_exists": os.path.exists("dist"),
    }

    db_ok = False
    db_error = None
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        db_error = str(exc)

    checks["database_ok"] = db_ok
    if db_error:
        checks["database_error"] = db_error

    ready = checks["data_dir_exists"] and checks["logo_exists"] and checks["dist_exists"] and db_ok

    return {
        "status": "ready" if ready else "not_ready",
        "checks": checks,
    }


@app.get("/api/system_overview")
def system_overview(db: Session = Depends(get_db)):
    active_provider = db.query(models.SystemSettings).first()
    active_smtp = get_active_smtp_account(db, active_provider, auto_import_legacy=False) if active_provider else None
    batch_counts = {
        "queued": db.query(models.BatchJob).filter(models.BatchJob.status == "queued").count(),
        "scheduled": db.query(models.BatchJob).filter(models.BatchJob.status == "scheduled").count(),
        "running": db.query(models.BatchJob).filter(models.BatchJob.status == "running").count(),
        "paused": db.query(models.BatchJob).filter(models.BatchJob.status == "paused").count(),
        "failed": db.query(models.BatchJob).filter(models.BatchJob.status == "failed").count(),
    }
    return {
        "active_provider": active_provider.active_provider if active_provider else None,
        "active_smtp_user": active_smtp.smtp_user if active_smtp else None,
        "batch_counts": batch_counts,
        "health": "attention" if batch_counts["failed"] else "ok",
    }
@app.get("/api/settings", response_model=schemas.SystemSettings)
def get_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    # Any active user can see basic settings, but sensitive fields should be masked in the response if possible.
    # For now, we allow reading for verified users.
    settings = db.query(models.SystemSettings).first()
    if not settings:
        settings = models.SystemSettings(
            active_provider="GMAIL",
            email_template_html="",
            email_template_subject="",
            email_template_creative_html="",
            email_template_creative_subject="",
            active_template_type="PROFESSIONAL",
            email_template_is_html=True
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    
    active_smtp = get_active_smtp_account(db, settings) if settings.active_provider in {"GMAIL_SMTP", "SMTP"} else None
    settings_dict = schemas.SystemSettings.from_orm(settings).dict()
    settings_dict["active_smtp_name"] = active_smtp.display_name if active_smtp else None
    return settings_dict

@app.post("/api/settings", response_model=schemas.SystemSettings)
def update_settings(
    payload: schemas.SystemSettingsUpdate, 
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_active_admin)
):
    settings = db.query(models.SystemSettings).first()
    if not settings:
        settings = models.SystemSettings()
        db.add(settings)

    if payload.active_provider == "BREVO":
        sender_email = (payload.brevo_sender_email or settings.brevo_sender_email or "").strip()
        if sender_email and not is_valid_email_address(sender_email):
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "Brevo sender email is invalid.",
                    "brevo_sender_invalid",
                    "Use a valid sender email address like name@company.com."
                )
            )

    smtp_user = payload.smtp_user if payload.smtp_user is not None else settings.smtp_user
    if smtp_user and not is_valid_email_address(str(smtp_user)):
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "SMTP email address is invalid.",
                "smtp_user_invalid",
                "Use the real email address for the SMTP account."
            )
        )
    
    payload_values = payload.dict(exclude_unset=True)
    if payload_values.get("smtp_password"):
        payload_values["smtp_password"] = encrypt_secret(payload_values["smtp_password"])

    for var, value in payload_values.items():
        setattr(settings, var, value)

    log_audit(
        db,
        action="settings.updated",
        entity_type="settings",
        entity_id=str(settings.id or 1),
        summary=f"Updated provider settings for {payload.active_provider or settings.active_provider}",
        metadata={"active_provider": payload.active_provider or settings.active_provider},
    )
    db.commit()
    db.refresh(settings)
    
    active_smtp = get_active_smtp_account(db, settings) if settings.active_provider in {"GMAIL_SMTP", "SMTP"} else None
    settings_dict = schemas.SystemSettings.from_orm(settings).dict()
    settings_dict["active_smtp_name"] = active_smtp.display_name if active_smtp else None
    return settings_dict


@app.api_route("/api/settings/verify", methods=["GET", "POST"])
def verify_settings_connection(db: Session = Depends(get_db)):
    """
    Connectivity check for the active email provider (Settings » Check connection).
    Returns JSON { ok: bool, message: str } — always HTTP 200 unless the server breaks.
    """
    settings = db.query(models.SystemSettings).first()
    if not settings:
        return {"ok": False, "message": "System settings are not initialized. Save settings first."}

    provider = (settings.active_provider or "").strip()

    try:
        if provider == "BREVO":
            if not (settings.brevo_api_key or "").strip():
                return {"ok": False, "message": "Brevo API key is missing."}
            from brevo_service import BrevoService

            service = BrevoService(api_key=settings.brevo_api_key)
            ok, msg = service.verify_api_key()
            return {"ok": ok, "message": msg}

        if provider in {"GMAIL_SMTP", "SMTP"}:
            from smtp_service import SmtpService

            active = get_active_smtp_account(db, settings)
            if not active:
                return {"ok": False, "message": "No SMTP account found. Add one and set it active."}
            if not active.smtp_password:
                return {"ok": False, "message": "SMTP password is missing for the active account."}
            pwd = decrypt_secret(active.smtp_password)
            service = SmtpService(
                host=active.smtp_host,
                port=active.smtp_port,
                user=active.smtp_user,
                password=pwd,
            )
            ok, msg = service.verify_login()
            return {"ok": ok, "message": msg}

        if provider == "GMAIL":
            from gmail_service import GmailService

            try:
                gs = GmailService()
            except Exception as e:
                return {"ok": False, "message": str(e)}
            ok, msg = gs.verify_connection()
            return {"ok": ok, "message": msg}

        return {"ok": False, "message": f"Unsupported provider: {provider or 'unknown'}"}
    except Exception as e:
        logger.exception("POST /api/settings/verify failed")
        return {"ok": False, "message": str(e)}


@app.get("/api/smtp_accounts", response_model=list[schemas.SmtpAccount])
def get_smtp_accounts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    settings = db.query(models.SystemSettings).first()
    import_legacy_smtp_account_if_needed(db, settings)

    query = db.query(models.SmtpAccount)
    if current_user.role != "admin":
        query = query.filter(models.SmtpAccount.user_id == current_user.id)
    
    accounts = query.order_by(models.SmtpAccount.created_at.asc()).all()
    if accounts and not any(account.is_active for account in accounts):
        active_account = ensure_single_active_smtp_account(db, accounts[0].id)
        sync_legacy_smtp_fields(settings, active_account)
        db.commit()
        accounts = db.query(models.SmtpAccount).order_by(models.SmtpAccount.created_at.asc()).all()

    return accounts


@app.post("/api/smtp_accounts", response_model=schemas.SmtpAccount)
def create_smtp_account(
    payload: schemas.SmtpAccountCreate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    validate_smtp_account_fields(
        payload.display_name,
        payload.smtp_host,
        payload.smtp_port,
        payload.smtp_user,
        payload.smtp_password,
        require_password=True,
    )

    existing = db.query(models.SmtpAccount).filter(
        models.SmtpAccount.smtp_host == payload.smtp_host,
        models.SmtpAccount.smtp_port == payload.smtp_port,
        models.SmtpAccount.smtp_user == payload.smtp_user,
    ).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "This SMTP account already exists.",
                "smtp_account_duplicate",
                "Edit the existing account or use a different email address."
            )
        )

    settings = db.query(models.SystemSettings).first()
    has_accounts = db.query(models.SmtpAccount).first() is not None
    should_activate = payload.is_active or not has_accounts

    account = models.SmtpAccount(
        user_id=current_user.id,
        display_name=payload.display_name.strip(),
        smtp_host=payload.smtp_host.strip(),
        smtp_port=int(payload.smtp_port),
        smtp_user=payload.smtp_user.strip(),
        smtp_password=encrypt_secret(payload.smtp_password),
        is_active=False,
    )
    db.add(account)
    db.flush()

    if should_activate:
        active_account = ensure_single_active_smtp_account(db, account.id)
        sync_legacy_smtp_fields(settings, active_account)

    log_audit(db, "smtp.created", "smtp_account", f"Created SMTP account {account.display_name}", metadata={"smtp_user": account.smtp_user, "is_active": should_activate})
    db.commit()
    db.refresh(account)
    return account


@app.put("/api/smtp_accounts/{account_id}", response_model=schemas.SmtpAccount)
def update_smtp_account(
    account_id: int, 
    payload: schemas.SmtpAccountUpdate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    query = db.query(models.SmtpAccount).filter(models.SmtpAccount.id == account_id)
    if current_user.role != "admin":
        query = query.filter(models.SmtpAccount.user_id == current_user.id)
    
    account = query.first()
    if not account:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "SMTP account not found.",
                "smtp_account_not_found",
                "Refresh the page and try again."
            )
        )

    updated_values = {
        "display_name": payload.display_name if payload.display_name is not None else account.display_name,
        "smtp_host": payload.smtp_host if payload.smtp_host is not None else account.smtp_host,
        "smtp_port": payload.smtp_port if payload.smtp_port is not None else account.smtp_port,
        "smtp_user": payload.smtp_user if payload.smtp_user is not None else account.smtp_user,
        "smtp_password": payload.smtp_password if payload.smtp_password is not None else account.smtp_password,
    }
    validate_smtp_account_fields(
        updated_values["display_name"],
        updated_values["smtp_host"],
        int(updated_values["smtp_port"]),
        updated_values["smtp_user"],
        payload.smtp_password if payload.smtp_password is not None else updated_values["smtp_password"],
        require_password=bool((updated_values["smtp_password"] or "").strip()),
    )

    duplicate = db.query(models.SmtpAccount).filter(
        models.SmtpAccount.id != account_id,
        models.SmtpAccount.smtp_host == updated_values["smtp_host"],
        models.SmtpAccount.smtp_port == int(updated_values["smtp_port"]),
        models.SmtpAccount.smtp_user == updated_values["smtp_user"],
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Another SMTP account already uses this combination.",
                "smtp_account_duplicate",
                "Change the host, port, or login email before saving."
            )
        )

    for field, value in updated_values.items():
        if field == "smtp_password" and payload.smtp_password is None:
            continue
        if field == "smtp_password":
            setattr(account, field, encrypt_secret(value))
            continue
        setattr(account, field, value.strip() if isinstance(value, str) else value)

    settings = db.query(models.SystemSettings).first()
    should_activate = payload.is_active is True or account.is_active
    if should_activate:
        active_account = ensure_single_active_smtp_account(db, account.id)
        sync_legacy_smtp_fields(settings, active_account)
    elif payload.is_active is False and account.is_active:
        other_account = db.query(models.SmtpAccount).filter(models.SmtpAccount.id != account_id).order_by(models.SmtpAccount.created_at.asc()).first()
        if other_account:
            active_account = ensure_single_active_smtp_account(db, other_account.id)
            sync_legacy_smtp_fields(settings, active_account)
        else:
            account.is_active = False
            sync_legacy_smtp_fields(settings, None)

    log_audit(db, "smtp.updated", "smtp_account", f"Updated SMTP account {account.display_name}", str(account_id), {"is_active": account.is_active})
    db.commit()
    db.refresh(account)
    return account


@app.post("/api/smtp_accounts/{account_id}/activate", response_model=schemas.SmtpAccount)
def activate_smtp_account(
    account_id: int, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    query = db.query(models.SmtpAccount).filter(models.SmtpAccount.id == account_id)
    if current_user.role != "admin":
        query = query.filter(models.SmtpAccount.user_id == current_user.id)
        
    account = query.first()
    if not account:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "SMTP account not found.",
                "smtp_account_not_found",
                "Refresh the page and try again."
            )
        )

    settings = db.query(models.SystemSettings).first()
    active_account = ensure_single_active_smtp_account(db, account.id)
    sync_legacy_smtp_fields(settings, active_account)
    log_audit(db, "smtp.activated", "smtp_account", f"Activated SMTP account {account.display_name}", str(account_id))
    db.commit()
    db.refresh(account)
    return account


@app.delete("/api/smtp_accounts/{account_id}")
def delete_smtp_account(
    account_id: int, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    query = db.query(models.SmtpAccount).filter(models.SmtpAccount.id == account_id)
    if current_user.role != "admin":
        query = query.filter(models.SmtpAccount.user_id == current_user.id)
        
    account = query.first()
    if not account:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "SMTP account not found.",
                "smtp_account_not_found",
                "Refresh the page and try again."
            )
        )

    was_active = account.is_active
    db.delete(account)
    db.flush()

    settings = db.query(models.SystemSettings).first()
    if was_active:
        next_account = db.query(models.SmtpAccount).order_by(models.SmtpAccount.created_at.asc()).first()
        if next_account:
            active_account = ensure_single_active_smtp_account(db, next_account.id)
            sync_legacy_smtp_fields(settings, active_account)
        else:
            sync_legacy_smtp_fields(settings, None)

    log_audit(db, "smtp.deleted", "smtp_account", f"Deleted SMTP account {account.display_name}", str(account_id), {"smtp_user": account.smtp_user})
    db.commit()
    return {"ok": True}


@app.get("/api/templates", response_model=list[schemas.EmailTemplate])
def list_templates(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    query = db.query(models.EmailTemplate).filter(models.EmailTemplate.is_active.is_(True))
    if current_user.role != "admin":
        query = query.filter(models.EmailTemplate.user_id == current_user.id)
    
    return query.order_by(models.EmailTemplate.updated_at.desc()).all()


@app.post("/api/templates", response_model=schemas.EmailTemplate)
def create_template(
    payload: schemas.EmailTemplateCreate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    validate_template_fields(payload.name, payload.subject, payload.html)
    latest = (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.name == payload.name)
        .order_by(models.EmailTemplate.version.desc())
        .first()
    )
    version = (latest.version + 1) if latest else 1
    template = models.EmailTemplate(
        user_id=current_user.id,
        name=payload.name.strip(),
        category=payload.category.strip() if payload.category else "General",
        subject=payload.subject,
        html=payload.html,
        is_html=payload.is_html,
        template_type=payload.template_type,
        version=version,
        is_active=True,
    )
    db.add(template)
    log_audit(db, "template.created", "template", f"Saved template {template.name}", metadata={"category": template.category, "version": version})
    db.commit()
    db.refresh(template)
    return template


@app.put("/api/templates/{template_id}", response_model=schemas.EmailTemplate)
def update_template(
    template_id: int, 
    payload: schemas.EmailTemplateUpdate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    query = db.query(models.EmailTemplate).filter(models.EmailTemplate.id == template_id)
    if current_user.role != "admin":
        query = query.filter(models.EmailTemplate.user_id == current_user.id)
    
    template = query.first()
    if not template:
        raise HTTPException(status_code=404, detail=error_detail("Template not found.", "template_not_found", "Refresh the page and try again."))

    validate_template_fields(payload.name, payload.subject, payload.html)
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(template, field, value)
    template.version += 1
    log_audit(db, "template.updated", "template", f"Updated template {template.name}", str(template_id), {"version": template.version})
    db.commit()
    db.refresh(template)
    return template


@app.delete("/api/templates/{template_id}")
def delete_template(
    template_id: int, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    query = db.query(models.EmailTemplate).filter(models.EmailTemplate.id == template_id)
    if current_user.role != "admin":
        query = query.filter(models.EmailTemplate.user_id == current_user.id)
    
    template = query.first()
    if not template:
        raise HTTPException(status_code=404, detail=error_detail("Template not found.", "template_not_found", "Refresh the page and try again."))
    template.is_active = False
    log_audit(db, "template.archived", "template", f"Archived template {template.name}", str(template_id))
    db.commit()
    return {"ok": True}


@app.get("/api/batches", response_model=list[schemas.BatchSummary])
def list_batches(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    query = db.query(models.BatchJob)
    if current_user.role != "admin":
        query = query.filter(models.BatchJob.user_id == current_user.id)
    
    batches = query.order_by(models.BatchJob.updated_at.desc()).limit(50).all()
    results = []
    for batch in batches:
        results.append({
            "batch": batch,
            "stats": build_batch_stats(db, batch.batch_id)
        })
    return results


PURGE_CONFIRM_PHRASE = "DELETE_ALL_BATCH_DATA"


@app.api_route("/api/batches/purge_all", methods=["POST", "DELETE"])
@app.api_route("/api/purge_all_batches", methods=["POST", "DELETE"])
@app.api_route("/api/admin/purge_batch_data", methods=["POST", "DELETE"])
def purge_all_batch_data(
    payload: schemas.PurgeAllBatchesPayload, 
    db: Session = Depends(get_db),
    current_admin: models.User = Depends(auth.get_current_active_admin)
):
    """Remove every row in `invoices` and `batch_jobs` (Status dashboard data). Does not touch settings, SMTP, or templates."""
    if (payload.confirm or "").strip() != PURGE_CONFIRM_PHRASE:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Confirmation phrase does not match.",
                "purge_confirm_mismatch",
                f'Type exactly: {PURGE_CONFIRM_PHRASE}',
            ),
        )
    active_batches = db.query(models.BatchJob).filter(
        models.BatchJob.status.in_(["queued", "scheduled", "running"])
    ).count()
    if active_batches:
        raise HTTPException(
            status_code=409,
            detail=error_detail(
                "Cannot purge while sends are in progress.",
                "purge_blocked_active_batches",
                "Pause/cancel active batches, then retry purge.",
            ),
        )
    n_inv = db.query(models.InvoiceData).delete()
    n_job = db.query(models.BatchJob).delete()
    n_audit = db.query(models.AuditLog).filter(models.AuditLog.entity_type == "batch").delete()
    attachments = db.query(models.BatchAttachment).all()
    for item in attachments:
        try:
            file_path = os.path.join(get_batch_attachments_dir(item.batch_id), item.stored_filename)
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass
    n_att = db.query(models.BatchAttachment).delete()
    log_audit(
        db,
        "batch.purge_all",
        "system",
        f"Cleared all batch dashboard data ({n_inv} invoice rows, {n_job} jobs, {n_att} attachments, {n_audit} batch audit rows).",
        None,
    )
    db.commit()
    return {"ok": True, "deleted_invoices": n_inv, "deleted_batch_jobs": n_job, "deleted_attachments": n_att, "deleted_batch_audit_logs": n_audit}


@app.get("/api/batches/{batch_id}/attachments", response_model=list[schemas.BatchAttachment])
def list_batch_attachments(
    batch_id: str, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    # Ensure current user owns this batch
    ensure_batch_job(db, batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    ensure_batch_exists_for_attachments(db, batch_id)
    return db.query(models.BatchAttachment).filter(
        models.BatchAttachment.batch_id == batch_id
    ).order_by(models.BatchAttachment.created_at.desc()).all()


@app.post("/api/batches/{batch_id}/attachments", response_model=schemas.BatchAttachment)
def upload_batch_attachment(
    batch_id: str, 
    file: UploadFile = File(...), 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    # Ensure current user owns this batch
    ensure_batch_job(db, batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    ensure_batch_exists_for_attachments(db, batch_id)
    stats = get_batch_attachment_stats(db, batch_id)
    if stats["count"] >= MAX_ATTACHMENTS_PER_BATCH:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Attachment limit reached.",
                "attachment_limit_reached",
                f"Maximum {MAX_ATTACHMENTS_PER_BATCH} attachments per batch.",
            ),
        )
    original_name = sanitize_attachment_filename(file.filename or "attachment.bin")
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "File type not allowed.",
                "attachment_type_not_allowed",
                f"Allowed types: {', '.join(sorted(ALLOWED_ATTACHMENT_EXTENSIONS))}",
            ),
        )
    content = file.file.read()
    size = len(content or b"")
    if size <= 0:
        raise HTTPException(status_code=400, detail=error_detail("File is empty.", "attachment_empty"))
    if size > MAX_ATTACHMENT_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Attachment is too large.",
                "attachment_too_large",
                "Maximum 10 MB per file.",
            ),
        )
    if stats["total_bytes"] + size > MAX_ATTACHMENTS_TOTAL_BYTES:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Total attachment size exceeded.",
                "attachment_total_size_exceeded",
                f"Keep combined attachment size under {MAX_ATTACHMENTS_TOTAL_MB} MB per batch.",
            ),
        )
    stored_name = f"{uuid.uuid4().hex}{ext}"
    full_path = os.path.join(get_batch_attachments_dir(batch_id), stored_name)
    with open(full_path, "wb") as out:
        out.write(content)
    mime = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    row = models.BatchAttachment(
        batch_id=batch_id,
        user_id=current_user.id,
        original_filename=original_name,
        stored_filename=stored_name,
        mime_type=mime,
        file_size=size,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/batches/{batch_id}/attachments/{attachment_id}")
def delete_batch_attachment(batch_id: str, attachment_id: int, db: Session = Depends(get_db)):
    ensure_batch_exists_for_attachments(db, batch_id)
    row = db.query(models.BatchAttachment).filter(
        models.BatchAttachment.id == attachment_id,
        models.BatchAttachment.batch_id == batch_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail=error_detail("Attachment not found.", "attachment_not_found"))
    try:
        full_path = os.path.join(get_batch_attachments_dir(batch_id), row.stored_filename)
        if os.path.exists(full_path):
            os.remove(full_path)
    except Exception:
        pass
    db.delete(row)
    db.commit()
    return {"ok": True}


@app.get("/api/batches/{batch_id}", response_model=schemas.BatchSummary)
def get_batch_summary(
    batch_id: str, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    batch = get_batch_job(db, batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    if not batch:
        # Fallback for historical batches not in batch_jobs table
        existing_records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id).count()
        if not existing_records:
            raise HTTPException(status_code=404, detail=error_detail("Batch not found.", "batch_not_found", "Start a new batch from the upload page."))
        batch = ensure_batch_job(db, batch_id)
        batch.status = "completed"
        db.commit()
        db.refresh(batch)
    return {"batch": batch, "stats": build_batch_stats(db, batch_id)}




@app.get("/api/batches/{batch_id}/validate")
def validate_batch(batch_id: str, subject: str, html: str, db: Session = Depends(get_db)):
    return evaluate_batch_validation(db, batch_id, subject, html)


@app.post("/api/batches/{batch_id}/pause", response_model=schemas.BatchJob)
def pause_batch(
    batch_id: str, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    batch = get_batch_job(db, batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    if not batch:
        raise HTTPException(status_code=404, detail=error_detail("Batch not found.", "batch_not_found", "Refresh the page and try again."))
    if batch.status not in {"queued", "scheduled", "running"}:
        raise HTTPException(status_code=400, detail=error_detail("This batch cannot be paused right now.", "batch_pause_invalid", "Only queued, scheduled, or running batches can be paused."))
    batch.status = "paused"
    batch.paused_at = datetime.datetime.utcnow()
    log_audit(db, "batch.paused", "batch", f"Paused batch {batch_id}", batch_id)
    db.commit()
    db.refresh(batch)
    return batch


@app.post("/api/batches/{batch_id}/resume", response_model=schemas.BatchJob)
def resume_batch(
    batch_id: str, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    batch = get_batch_job(db, batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    if not batch:
        raise HTTPException(status_code=404, detail=error_detail("Batch not found.", "batch_not_found", "Refresh the page and try again."))
    if batch.status not in {"paused", "cancelled", "failed"}:
        raise HTTPException(status_code=400, detail=error_detail("This batch cannot be resumed right now.", "batch_resume_invalid", "Only paused or interrupted batches can be resumed."))
    batch.status = "queued"
    batch.paused_at = None
    batch.cancelled_at = None
    batch.last_error = None
    log_audit(db, "batch.resumed", "batch", f"Resumed batch {batch_id}", batch_id)
    db.commit()
    db.refresh(batch)
    return batch


@app.post("/api/batches/{batch_id}/cancel", response_model=schemas.BatchJob)
def cancel_batch(
    batch_id: str, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    batch = get_batch_job(db, batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    if not batch:
        raise HTTPException(status_code=404, detail=error_detail("Batch not found.", "batch_not_found", "Refresh the page and try again."))
    if batch.status in {"completed", "cancelled"}:
        raise HTTPException(status_code=400, detail=error_detail("This batch is already closed.", "batch_cancel_invalid", "Only open batches can be cancelled."))
    batch.status = "cancelled"
    batch.cancelled_at = datetime.datetime.utcnow()
    log_audit(db, "batch.cancelled", "batch", f"Cancelled batch {batch_id}", batch_id)
    db.commit()
    db.refresh(batch)
    return batch


@app.post("/api/batches/{batch_id}/retry_failed", response_model=schemas.BatchJob)
def retry_failed_batch(
    batch_id: str, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    batch = get_batch_job(db, batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    if not batch:
        raise HTTPException(status_code=404, detail=error_detail("Batch not found.", "batch_not_found", "Refresh the page and try again."))

    rows = db.query(models.InvoiceData).filter(
        models.InvoiceData.batch_id == batch_id,
        models.InvoiceData.status.in_(["failed", "partial"])
    ).all()
    if not rows:
        raise HTTPException(status_code=400, detail=error_detail("There are no failed rows to retry.", "batch_retry_empty", "This batch has no failed or partial rows."))

    for row in rows:
        row.status = "pending"
        row.error_message = None
    batch.status = "queued"
    batch.last_error = None
    log_audit(db, "batch.retry_failed", "batch", f"Retrying failed rows for batch {batch_id}", batch_id, {"row_count": len(rows)})
    db.commit()
    db.refresh(batch)
    return batch


@app.get("/api/audit_logs", response_model=list[schemas.AuditLog])
def get_audit_logs(limit: int = 50, db: Session = Depends(get_db)):
    return db.query(models.AuditLog).order_by(models.AuditLog.created_at.desc()).limit(min(limit, 200)).all()

@app.get("/api/check_gmail")
def check_gmail_status(db: Session = Depends(get_db)):
    creds_exist = os.path.exists(CREDENTIALS_PATH)
    token_exist = os.path.exists(TOKEN_PATH)
    settings = db.query(models.SystemSettings).first()
    has_db_creds = bool(settings and settings.gmail_client_id and settings.gmail_client_secret)
    
    if token_exist:
        status = "Connected"
    elif has_db_creds or creds_exist:
        status = "Ready to Connect"
    else:
        status = "Not Configured"

    return {
        "credentials": creds_exist or has_db_creds,
        "authenticated": token_exist,
        "status": status,
        "has_db_credentials": has_db_creds
    }

@app.post("/api/gmail/auth")
def gmail_authenticate(request: Request, db: Session = Depends(get_db)):
    """Return authorization URL for Google OAuth flow."""
    settings = db.query(models.SystemSettings).first()

    from google_auth_oauthlib.flow import Flow
    SCOPES = ['https://www.googleapis.com/auth/gmail.send']

    redirect_uri = build_gmail_redirect_uri(request)
    client_config = _get_gmail_client_config(settings, redirect_uri)

    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )
    
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true',
        prompt='consent'
    )
    
    response = JSONResponse({"auth_url": authorization_url, "redirect_uri": redirect_uri})
    response.set_cookie(
        key=GMAIL_OAUTH_STATE_COOKIE,
        value=state,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        max_age=600,
        path="/"
    )
    return response

@app.get("/api/gmail/callback")
async def gmail_callback(request: Request, code: str, state: Optional[str] = None, db: Session = Depends(get_db)):
    """Handle the OAuth2 callback, exchange code for tokens, and save."""
    settings = db.query(models.SystemSettings).first()

    from google_auth_oauthlib.flow import Flow
    SCOPES = ['https://www.googleapis.com/auth/gmail.send']

    redirect_uri = build_gmail_redirect_uri(request)
    client_config = _get_gmail_client_config(settings, redirect_uri)

    cookie_state = request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)
    if not state or not cookie_state or state != cookie_state:
        response = RedirectResponse(url="/settings?auth=failed&error=Invalid%20OAuth%20state")
        response.delete_cookie(GMAIL_OAUTH_STATE_COOKIE, path="/")
        return response
    
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )

    try:
        flow.fetch_token(code=code)
        creds = flow.credentials
        with open(TOKEN_PATH, "w") as token:
            token.write(creds.to_json())

        response = RedirectResponse(url="/settings?auth=success")
        response.delete_cookie(GMAIL_OAUTH_STATE_COOKIE, path="/")
        return response
    except Exception as e:
        logger.error(f"Gmail callback error: {e}")
        response = RedirectResponse(url=f"/settings?auth=failed&error={quote(str(e))}")
        response.delete_cookie(GMAIL_OAUTH_STATE_COOKIE, path="/")
        return response

@app.delete("/api/gmail/auth")
def gmail_disconnect():
    """Remove the stored Gmail token to disconnect Gmail."""
    removed = []
    for f in [str(TOKEN_PATH)]:
        if os.path.exists(f):
            os.remove(f)
            removed.append(f)
    return {"success": True, "message": "Gmail disconnected.", "removed": removed}

_AMOUNT_KEYWORDS = {
    "amount", "price", "total", "fee", "cost", "balance", "due", "paid",
    "value", "charge", "payment", "outstanding", "invoice", "bill", "salary",
    "revenue", "profit", "tax", "discount", "payable", "receivable", "rate",
}


def _is_amount_like_key(key: str) -> bool:
    """Return True if the column/tag name suggests a monetary/currency value."""
    words = set(re.sub(r"[\s_\-]", " ", key.lower()).split())
    return bool(words & _AMOUNT_KEYWORDS)


def _try_format_date(val_str: str) -> Optional[str]:
    """Try to parse val_str as a date. Returns 'DD/MM/YYYY' or None."""
    if not val_str or len(val_str) < 6:
        return None
    # Already DD/MM/YYYY — return as-is
    if re.match(r"^\d{2}/\d{2}/\d{4}$", val_str):
        return val_str
    # Strip time portion before parsing: "2024-01-15 14:30:00" → "2024-01-15"
    clean = re.split(r"[T ]", val_str.strip())[0]
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y",
                "%d.%m.%Y", "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y", "%B %d, %Y"):
        try:
            return datetime.datetime.strptime(clean, fmt).strftime("%d/%m/%Y")
        except Exception:
            pass
    # Last resort: pandas (handles many locale formats)
    try:
        dt = pd.to_datetime(val_str, dayfirst=True, errors="raise")
        if not pd.isna(dt):
            return dt.strftime("%d/%m/%Y")
    except Exception:
        pass
    return None


def _smart_cell_to_str(val) -> str:
    """Convert any cell value to a clean, human-readable string.

    - datetime / Timestamp  → DD/MM/YYYY  (no time, no 00:00:00 noise)
    - bool                  → Yes / No
    - int                   → plain integer string
    - float (whole number)  → integer string  (avoids "45306.0" serial-date noise)
    - float (decimal)       → trimmed decimal  ("1500.5" not "1500.500000")
    - timestamp strings     → DD/MM/YYYY  (catches Excel-exported CSVs)
    - pandas artefacts      → ""
    """
    if val is None:
        return ""
    if isinstance(val, float) and pd.isna(val):
        return ""
    try:
        if val is pd.NaT:
            return ""
    except Exception:
        pass
    if isinstance(val, pd.Timestamp):
        return "" if pd.isna(val) else val.strftime("%d/%m/%Y")
    if isinstance(val, datetime.datetime):
        return val.strftime("%d/%m/%Y")
    if isinstance(val, datetime.date):
        return val.strftime("%d/%m/%Y")
    # bool must come before int (bool is subclass of int)
    if isinstance(val, bool):
        return "Yes" if val else "No"
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        if val == int(val):
            return str(int(val))
        # Trim trailing zeros: 1500.5 → "1500.5", not "1500.500000"
        return f"{val:.10g}"
    s = str(val).strip()
    if s in ("nan", "None", "NaT", "none", "null", "NaN", ""):
        return ""
    # Catch timestamp strings from Excel-exported CSVs: "2024-01-15 00:00:00"
    ts_match = re.match(r"^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}:\d{2}", s)
    if ts_match:
        try:
            return datetime.datetime(
                int(ts_match.group(1)), int(ts_match.group(2)), int(ts_match.group(3))
            ).strftime("%d/%m/%Y")
        except Exception:
            pass
    return s


def safe_read_file(contents: bytes, filename: str) -> pd.DataFrame:
    """
    Bulletproof file reader that handles dozens of edge cases:
    - Empty files, corrupted files, password-protected files
    - CSV: encoding issues (UTF-8, Latin-1, cp1252), bad delimiters, malformed rows
    - Excel: .xlsx, .xls, multiple sheets, merged cells, formula-only cells
    - Data: NaN/None/NaT, mixed types, float columns, date objects
    - Structure: duplicate column names, unnamed columns, leading empty rows
    - Size: caps at 10,000 rows to prevent memory issues
    """
    MAX_ROWS = 10000
    
    if not contents or len(contents) == 0:
        raise HTTPException(status_code=400, detail=error_detail(
            "The uploaded file is empty.",
            "file_empty",
            "Export the sheet again and make sure it contains data rows."
        ))
    
    df = None
    
    if filename.endswith(".csv"):
        # Try multiple strategies for CSV files
        encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252', 'iso-8859-1']
        separators = [',', ';', '\t', '|']
        
        for enc in encodings:
            for sep in separators:
                try:
                    df = pd.read_csv(
                        io.BytesIO(contents),
                        encoding=enc,
                        sep=sep,
                        engine='python',
                        on_bad_lines='skip',
                        encoding_errors='ignore',
                        nrows=MAX_ROWS,
                        dtype=str,           # Read everything as string from the start
                        keep_default_na=False # Don't interpret "NA", "null" etc. as NaN
                    )
                    # If we got more than 1 column, this separator works
                    if df is not None and len(df.columns) > 1:
                        break
                except Exception:
                    continue
            if df is not None and len(df.columns) > 1:
                break
        
        # Last resort: read with defaults
        if df is None or len(df.columns) <= 1:
            try:
                df = pd.read_csv(
                    io.BytesIO(contents),
                    engine='python',
                    on_bad_lines='skip',
                    encoding_errors='ignore',
                    nrows=MAX_ROWS,
                    dtype=str,
                    keep_default_na=False
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=error_detail(
                    f"Could not parse CSV file: {str(e)[:100]}",
                    "csv_parse_failed",
                    "Ensure the file is a valid CSV with comma, semicolon, or tab delimiters."
                ))
    
    elif filename.endswith((".xlsx", ".xls")):
        engine = "openpyxl" if filename.endswith(".xlsx") else None

        # Open the workbook once so we can inspect all sheets without re-reading bytes
        xl_file = None
        sheet_names: list = [0]
        try:
            xl_file = pd.ExcelFile(io.BytesIO(contents), engine=engine)
            sheet_names = xl_file.sheet_names or [0]
        except Exception:
            pass  # Fall back to single-sheet index-based read

        best_df = None
        best_score = -1

        # Try each sheet and each candidate header row; keep the richest result
        for sheet in sheet_names[:5]:           # Limit to first 5 sheets
            for header_row in range(3):         # Try header at row 0, 1, 2
                try:
                    read_kw = {"header": header_row, "keep_default_na": False, "nrows": MAX_ROWS}
                    if engine:
                        read_kw["engine"] = engine
                    if xl_file is not None:
                        temp_df = xl_file.parse(sheet, **read_kw)
                    else:
                        temp_df = pd.read_excel(io.BytesIO(contents), sheet_name=sheet, **read_kw)

                    if temp_df is None or temp_df.empty or len(temp_df.columns) < 2:
                        continue
                    # Score by (rows × columns) — more data = better sheet/header combo
                    score = len(temp_df) * len(temp_df.columns)
                    if score > best_score:
                        best_df = temp_df
                        best_score = score
                        break  # Found a valid header row for this sheet
                except Exception:
                    continue

        if best_df is None:
            raise HTTPException(status_code=400, detail=error_detail(
                "Could not parse Excel file.",
                "excel_parse_failed",
                "Ensure the file is a valid .xlsx or .xls file and is not password-protected or corrupted."
            ))

        # Apply smart per-cell conversion (preserves dates, strips time, cleans floats)
        df = best_df
        for col in df.columns:
            df[col] = df[col].apply(_smart_cell_to_str)
    else:
        raise HTTPException(status_code=400, detail=error_detail(
            "Unsupported file format. Only CSV and Excel files are accepted.",
            "file_type_unsupported",
            "Upload a CSV (.csv) or Excel (.xlsx, .xls) file."
        ))
    
    # --- POST-READ SANITIZATION (handles all remaining edge cases) ---
    
    # 1. Drop completely empty rows and columns
    if df is not None:
        df = df.dropna(how='all', axis=0)  # Drop rows where ALL values are NaN
        df = df.dropna(how='all', axis=1)  # Drop columns where ALL values are NaN
    
    # 2. Handle unnamed/duplicate columns
    new_cols = []
    seen = {}
    for i, col in enumerate(df.columns):
        col_str = str(col).strip()
        # Replace unnamed columns (pandas auto-generates "Unnamed: 0" etc.)
        if col_str.startswith("Unnamed") or col_str == "" or col_str == "nan":
            col_str = f"Column_{i+1}"
        # Handle duplicates by appending a suffix
        if col_str in seen:
            seen[col_str] += 1
            col_str = f"{col_str}_{seen[col_str]}"
        else:
            seen[col_str] = 0
        new_cols.append(col_str)
    df.columns = new_cols
    
    # 3. Universal type safety: apply _smart_cell_to_str to every cell.
    # For CSV (read as dtype=str) this cleans timestamp strings like "2024-01-15 00:00:00".
    # For Excel columns not yet converted (edge cases), this also handles them.
    for col in df.columns:
        df[col] = df[col].apply(_smart_cell_to_str)
    
    # 4. Drop rows that are entirely empty after cleaning
    df = df[~(df == "").all(axis=1)]
    
    # 5. Reset index after dropping rows
    df = df.reset_index(drop=True)
    
    # 6. Final validation
    if df.empty or len(df.columns) == 0:
        raise HTTPException(status_code=400, detail=error_detail(
            "The uploaded file appears to be empty after processing.",
            "file_has_no_data",
            "Make sure the sheet contains headers and at least one data row."
        ))
    
    if len(df.columns) > 100:
        raise HTTPException(status_code=400, detail=error_detail(
            f"Too many columns ({len(df.columns)}). Maximum is 100.",
            "too_many_columns",
            "Reduce the number of columns in your spreadsheet."
        ))
    
    return df


@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    if not file or not file.filename:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "No file was provided.",
                "file_missing",
                "Choose a CSV or XLSX invoice file and try again."
            )
        )

    contents = await file.read()
    filename = file.filename.lower()
    
    try:
        df = safe_read_file(contents, filename)
            
        return {
            "columns": [str(c) for c in df.columns.tolist()],
            "sample_data": df.head(3).to_dict(orient="records"),
            "recommended_mapping": heuristic_column_discovery(df)
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Upload error: {e}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=error_detail(
                "The file could not be read.",
                "file_read_failed",
                "Check whether the file is corrupted or locked by another program."
            )
        )

@app.post("/api/process_upload")
async def process_upload(
    mapping: str = Form(...), 
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    if not file or not file.filename:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "No file was provided for processing.",
                "process_file_missing",
                "Upload the spreadsheet again and retry the mapping step."
            )
        )

    contents = await file.read()
    filename = file.filename.lower()
    
    try:
        mapping_dict = json.loads(mapping)
        validate_mapping(mapping_dict)

        df = safe_read_file(contents, filename)
        missing_columns = [
            label for label, column_name in {
                "Email": mapping_dict.get("email"),
                "Name": mapping_dict.get("name"),
                "Amount": mapping_dict.get("amount"),
                "Due Date": mapping_dict.get("date"),
            }.items()
            if column_name and column_name not in df.columns
        ]
        if missing_columns:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    f"Some mapped columns were not found in the file: {', '.join(missing_columns)}.",
                    "mapped_columns_missing",
                    "Re-upload the file or remap the columns shown in Step 1."
                )
            )

        batch_id = str(uuid.uuid4())
        records_to_insert = []
        skipped_rows = 0
        
        for _, row in df.iterrows():
            email = str(row.get(mapping_dict.get("email"), ""))
            recipients = normalize_email_list(email)
            if not recipients or not all(is_valid_email_address(item) for item in recipients):
                skipped_rows += 1
                continue

            record = models.InvoiceData(
                batch_id=batch_id,
                user_id=current_user.id,
                recipient_name=str(row.get(mapping_dict.get("name"), "Recipient")),
                email_address=email,
                invoice_amount=str(row.get(mapping_dict.get("amount"), "0.00")),
                due_date=str(row.get(mapping_dict.get("date"), "N/A")),
                row_data=json.dumps({str(k): v for k, v in row.to_dict().items() if v != ""}),
                status="pending"
            )
            records_to_insert.append(record)
        
        if not records_to_insert:
             raise HTTPException(
                 status_code=400,
                 detail=error_detail(
                     "No rows with valid email addresses were found.",
                     "no_valid_emails",
                     "Map the correct Email column and verify the file contains valid email addresses."
                 )
             )

        db.bulk_save_objects(records_to_insert)
        batch = ensure_batch_job(db, batch_id, file.filename, user_id=current_user.id)
        batch.status = "draft"
        log_audit(db, "batch.created", "batch", f"Created batch {batch_id}", batch_id, {"source_filename": file.filename, "row_count": len(records_to_insert)})
        db.commit()
        response = {
            "batch_id": batch_id,
            "count": len(records_to_insert),
            "skipped_rows": skipped_rows
        }
        if skipped_rows:
            response["warning"] = f"{skipped_rows} row(s) were skipped because the email address was missing or invalid."
        return response
    except json.JSONDecodeError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Column mapping data could not be read.",
                "mapping_parse_failed",
                "Refresh the page, remap your columns, and try again."
            )
        )
    except HTTPException as e:
        db.rollback()
        raise e
    except Exception as e:
        logger.error(f"Process upload error: {e}\n{traceback.format_exc()}")
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=error_detail(
                "The uploaded data could not be processed.",
                "process_upload_failed",
                "Check the file format and column mapping, then try again."
            )
        )

@app.get("/api/status/{batch_id}", response_model=list[schemas.Invoice])
def get_status(batch_id: str, db: Session = Depends(get_db)):
    records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id).all()
    if not records:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "Batch not found.",
                "batch_not_found",
                "Start a new batch from the upload page or verify the status URL."
            )
        )
    return records

@app.get("/api/batches/{batch_id}/recipients", response_model=schemas.RecipientListResponse)
def list_batch_recipients(batch_id: str, db: Session = Depends(get_db)):
    records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id).order_by(models.InvoiceData.id.asc()).all()
    if not records:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "Batch not found.",
                "batch_not_found",
                "Upload and process a file before managing recipients."
            )
        )
    stats = build_batch_stats(db, batch_id)
    return {
        "items": records,
        "total": stats["total"],
        "pending": stats["pending"],
        "success": stats["success"],
        "failed": stats["failed"],
        "partial": stats["partial"],
    }


@app.patch("/api/batches/{batch_id}/recipients/{invoice_id}", response_model=schemas.Invoice)
def update_batch_recipient(batch_id: str, invoice_id: int, payload: schemas.RecipientUpdatePayload, db: Session = Depends(get_db)):
    record = db.query(models.InvoiceData).filter(
        models.InvoiceData.batch_id == batch_id,
        models.InvoiceData.id == invoice_id,
    ).first()
    if not record:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "Recipient row not found.",
                "recipient_not_found",
                "Refresh the recipient list and try again."
            )
        )

    updates = payload.dict(exclude_unset=True)
    if "email_address" in updates:
        recipients = normalize_email_list(updates["email_address"])
        if not recipients or not all(is_valid_email_address(item) for item in recipients):
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "Recipient email is invalid.",
                    "recipient_email_invalid",
                    "Use one or more valid emails separated by commas."
                )
            )
        record.email_address = updates["email_address"]
    if "recipient_name" in updates:
        record.recipient_name = updates["recipient_name"] or "Recipient"
    if "invoice_amount" in updates:
        record.invoice_amount = updates["invoice_amount"] or "0.00"
    if "due_date" in updates:
        record.due_date = updates["due_date"] or "N/A"

    try:
        row_data = json.loads(record.row_data) if record.row_data else {}
    except Exception:
        row_data = {}
    row_data["Recipient"] = record.recipient_name
    row_data["Client Name"] = record.recipient_name
    row_data["Email"] = record.email_address
    row_data["Amount"] = record.invoice_amount
    row_data["Due Date"] = record.due_date
    record.row_data = json.dumps(row_data)

    if record.status in {"failed", "partial"}:
        record.status = "pending"
        record.error_message = None

    db.commit()
    db.refresh(record)
    return record


@app.post("/api/batches/{batch_id}/recipients/send")
def send_selected_recipients(
    batch_id: str, 
    payload: schemas.RecipientSendModePayload, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    batch = get_batch_job(db, batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    if not batch:
        raise HTTPException(
            status_code=404,
            detail=error_detail("Batch not found.", "batch_not_found", "Upload and process data first.")
        )

    settings = db.query(models.SystemSettings).first()
    if not settings:
        raise HTTPException(
            status_code=400,
            detail=error_detail("System settings are missing.", "settings_missing", "Configure provider settings first.")
        )

    mode = (payload.mode or "").strip().lower()
    if mode not in {"single", "selected", "all_pending"}:
        raise HTTPException(
            status_code=400,
            detail=error_detail("Invalid send mode.", "send_mode_invalid", "Use single, selected, or all_pending.")
        )

    if mode == "single":
        if not payload.invoice_id:
            raise HTTPException(status_code=400, detail=error_detail("invoice_id is required for single mode.", "invoice_id_required"))
        target_ids = [payload.invoice_id]
    elif mode == "selected":
        if not payload.invoice_ids:
            raise HTTPException(status_code=400, detail=error_detail("invoice_ids are required for selected mode.", "invoice_ids_required"))
        target_ids = payload.invoice_ids
    else:
        target_ids = [
            row.id for row in db.query(models.InvoiceData).filter(
                models.InvoiceData.batch_id == batch_id,
                models.InvoiceData.status == "pending"
            ).all()
        ]

    rows = db.query(models.InvoiceData).filter(
        models.InvoiceData.batch_id == batch_id,
        models.InvoiceData.id.in_(target_ids)
    ).all() if target_ids else []

    if not rows:
        raise HTTPException(
            status_code=400,
            detail=error_detail("No matching recipients found for this send action.", "recipients_not_found")
        )

    effective_template_type, base_subject, base_raw_message, wrapper_template = resolve_template_and_wrapper(
        settings,
        payload.template_type,
        payload.custom_subject,
        payload.custom_html,
    )
    validate_send_payload(batch_id, base_subject, base_raw_message)
    service = build_provider_service(settings, db)
    attachment_stats = get_batch_attachment_stats(db, batch_id)
    if attachment_stats["total_bytes"] > MAX_ATTACHMENTS_TOTAL_BYTES:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Total attachment size exceeded.",
                "attachment_total_size_exceeded",
                f"Reduce attachments to stay under {MAX_ATTACHMENTS_TOTAL_MB} MB per batch.",
            ),
        )
    attachments = attachment_payloads_for_batch(db, batch_id)

    sent_rows = 0
    failed_rows = 0
    for row in rows:
        if row.status == "success":
            continue
        result = send_record(
            db,
            row,
            settings,
            service,
            base_subject,
            base_raw_message,
            wrapper_template,
            payload.is_html,
            attachments,
        )
        if result["ok"]:
            sent_rows += 1
        else:
            failed_rows += 1

    stats = build_batch_stats(db, batch_id)
    batch.provider = settings.active_provider
    batch.template_type = effective_template_type
    batch.custom_subject = base_subject
    batch.custom_html = base_raw_message
    batch.is_html = payload.is_html
    batch.validation_summary = json.dumps(evaluate_batch_validation(db, batch_id, base_subject, base_raw_message))
    batch.status = "completed" if stats["pending"] == 0 else "running"
    db.commit()

    return {
        "ok": True,
        "mode": mode,
        "processed": len(rows),
        "sent_rows": sent_rows,
        "failed_rows": failed_rows,
        "stats": stats,
    }

@app.get("/api/report/{batch_id}")
def generate_report(batch_id: str, db: Session = Depends(get_db)):
    records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id).all()
    if not records:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "Batch not found.",
                "report_batch_not_found",
                "Refresh the status page and retry the export."
            )
        )
        
    df = pd.DataFrame([{
        "Recipient Name": r.recipient_name,
        "Email Address": r.email_address,
        "Invoice Amount": r.invoice_amount,
        "Due Date": r.due_date,
        "Status": r.status,
        "Error Message": r.error_message,
    } for r in records])
    
    stream = io.StringIO()
    df.to_csv(stream, index=False)
    response = StreamingResponse(iter([stream.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename=report_{batch_id}.csv"
    return response

@app.post("/api/send_emails")
def send_emails(
    payload: schemas.SendEmailPayload, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    logger.info(f"--- [SEND EMAILS] Received for batch {payload.batch_id} for user {current_user.email} ---")
    try:
        # Security check: Does this user own this batch?
        batch = get_batch_job(db, payload.batch_id, user_id=None if current_user.role == "admin" else current_user.id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        validate_send_payload(payload.batch_id, payload.custom_subject, payload.custom_html)
        logger.info(f"[SEND EMAILS] Validation payload: ok")
        
        records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == payload.batch_id, models.InvoiceData.status == "pending").all()
        logger.info(f"[SEND EMAILS] Fetched {len(records)} pending records")
        
        if not records:
             logger.warning(f"[SEND EMAILS] No pending records for batch {payload.batch_id}")
             raise HTTPException(
                 status_code=400,
                 detail=error_detail(
                     "There are no pending emails left in this batch.",
                     "no_pending_records",
                     "Refresh the status page to review what has already been sent."
                 )
             )

        settings = db.query(models.SystemSettings).first()
        validate_email_provider(settings, db)
        logger.info(f"[SEND EMAILS] Settings/Provider: ok")
        attachment_stats = get_batch_attachment_stats(db, payload.batch_id)
        if attachment_stats["total_bytes"] > MAX_ATTACHMENTS_TOTAL_BYTES:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "Total attachment size exceeded.",
                    "attachment_total_size_exceeded",
                    f"Reduce attachments to stay under {MAX_ATTACHMENTS_TOTAL_MB} MB per batch.",
                ),
            )
        
        logger.info(f"[SEND EMAILS] Evaluating batch validation...")
        validation = evaluate_batch_validation(db, payload.batch_id, payload.custom_subject or "", payload.custom_html or "")
        logger.info(f"[SEND EMAILS] Validation results: {validation['ok_to_send']}")
        
        if not validation["ok_to_send"]:
            logger.warning(f"[SEND EMAILS] Validation failed: {validation['issues']}")
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "This batch has blocking validation issues.",
                    "batch_validation_failed",
                    "Resolve unresolved placeholders or invalid rows before launching the send."
                )
            )

        now_utc = utc_now_aware()
        dispatch_plan = None
        if payload.campaign_pacing and payload.campaign_pacing.enabled:
            dispatch_plan = build_dispatch_plan(now_utc, len(records), payload.campaign_pacing)

        batch = ensure_batch_job(db, payload.batch_id)
        batch.provider = settings.active_provider
        batch.custom_subject = payload.custom_subject
        batch.custom_html = payload.custom_html
        batch.template_type = payload.template_type or "PROFESSIONAL"
        batch.is_html = payload.is_html
        batch.last_error = None
        delivery_snapshot = build_batch_delivery_snapshot(settings, db)
        persist_batch_metadata(batch, validation, dispatch_plan, delivery_snapshot)

        if dispatch_plan:
            first_slot = dispatch_plan["slots"][0] if dispatch_plan.get("slots") else None
            if first_slot:
                raw = first_slot["scheduled_for"]
                first_slot_at = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
                first_slot_at = to_utc_aware(first_slot_at)
            else:
                first_slot_at = now_utc
            batch.scheduled_for = first_slot_at
            batch.status = "scheduled" if first_slot_at > now_utc else "queued"
        else:
            batch.scheduled_for = payload.scheduled_for
            sched_cmp = to_utc_aware(payload.scheduled_for)
            batch.status = "scheduled" if sched_cmp and sched_cmp > now_utc else "queued"
        
        logger.info(f"[SEND EMAILS] Updating batch status to {batch.status}")
        
        log_audit(
            db,
            "batch.queued" if batch.status == "queued" else "batch.scheduled",
            "batch",
            f"{'Queued' if batch.status == 'queued' else 'Scheduled'} batch {payload.batch_id}",
            payload.batch_id,
            {
                "provider": settings.active_provider,
                "scheduled_for": batch.scheduled_for.isoformat() if batch.scheduled_for else None,
                "campaign_pacing": dispatch_plan,
            },
        )
        
        logger.info(f"[SEND EMAILS] Committing batch...")
        db.commit()
        logger.info(f"[SEND EMAILS] Batch committed. Ensuring worker running...")
        ensure_worker_running()
        logger.info(f"[SEND EMAILS] Done.")
        
    except Exception as e:
        logger.error(f"--- [SEND EMAILS CRASH] --- \n {e}\n{traceback.format_exc()}")
        db.rollback()
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail="Internal server crash during send_emails.")
    return {
        "ok": True,
        "message": "Email sending has been queued." if batch.status == "queued" else "Email sending has been scheduled.",
        "batch_status": batch.status,
        "validation": validation,
        "dispatch_plan_summary": {
            "enabled": bool(dispatch_plan),
            "slots": len(dispatch_plan.get("slots", [])) if dispatch_plan else 0,
            "total_planned": dispatch_plan.get("total_planned") if dispatch_plan else len(records),
            "effective_min_per_slot": dispatch_plan.get("effective_min_per_slot") if dispatch_plan else None,
            "effective_max_per_slot": dispatch_plan.get("effective_max_per_slot") if dispatch_plan else None,
        },
        "detail": {
            "message": "Email sending has started in the background." if batch.status == "queued" else "Email sending has been scheduled.",
            "code": "send_started" if batch.status == "queued" else "send_scheduled"
        }
    }


@app.post("/api/launch")
def launch(payload: schemas.SendEmailPayload, db: Session = Depends(get_db)):
    # Backward-compatible alias used by current frontend.
    return send_emails(payload, db)

@app.post("/api/send_test_email")
def send_test_email(
    payload: schemas.TestEmailPayload, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    # Security check: Does this user own this batch?
    batch = get_batch_job(db, payload.batch_id, user_id=None if current_user.role == "admin" else current_user.id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    from gmail_service import GmailService
    from brevo_service import BrevoService
    from smtp_service import SmtpService
    
    validate_send_payload(payload.batch_id, payload.custom_subject, payload.custom_html)
    if not is_valid_email_address(payload.test_email):
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "The test email address is invalid.",
                "test_email_invalid",
                "Enter a valid email address like name@example.com."
            )
        )

    # 1. Fetch sample record from batch
    record = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == payload.batch_id).first()
    if not record:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "No sample data was found for this batch.",
                "sample_batch_missing",
                "Upload and process a file before sending a test email."
            )
        )
    
    # 2. Setup Service
    settings = db.query(models.SystemSettings).first()
    validate_email_provider(settings, db)
    active_smtp_account = get_active_smtp_account(db, settings) if settings.active_provider in {"GMAIL_SMTP", "SMTP"} else None
        
    if settings.active_provider == "BREVO":
        service = BrevoService(api_key=settings.brevo_api_key)
    elif settings.active_provider == "GMAIL_SMTP" or settings.active_provider == "SMTP":
        service = SmtpService(
            host=active_smtp_account.smtp_host,
            port=active_smtp_account.smtp_port,
            user=active_smtp_account.smtp_user,
            password=decrypt_secret(active_smtp_account.smtp_password),
        )
    else:
        service = GmailService()
        
    # 3. Preparation
    context = json.loads(record.row_data) if record.row_data else {}
    # Smart Date Formatting
    formatted_date = record.due_date
    try:
        if record.due_date:
            dt = pd.to_datetime(record.due_date)
            formatted_date = dt.strftime('%d/%m/%y')
    except: pass

    context.update({
        "Name": record.recipient_name, "Recipient": record.recipient_name,
        "Amount": record.invoice_amount, "Value": record.invoice_amount,
        "Invoice Amount": record.invoice_amount,
        "Due Date": formatted_date, "Date": formatted_date,
        "Email": record.email_address
    })
    
    # Select Base Template and Wrapper
    if payload.template_type == "CREATIVE":
        base_subject = payload.custom_subject or settings.email_template_creative_subject or "An update for you!"
        base_raw_message = payload.custom_html or settings.email_template_creative_html or SAMPLE_MESSAGE_CREATIVE
        wrapper_template = DEFAULT_HTML_TEMPLATE_CREATIVE
    else:
        base_subject = payload.custom_subject or settings.email_template_subject or "Professional Update"
        base_raw_message = payload.custom_html or settings.email_template_html or SAMPLE_MESSAGE
        wrapper_template = DEFAULT_HTML_TEMPLATE

    subject = substitute_variables(base_subject, context)
    content = substitute_variables(base_raw_message, context)
    
    # SMART LOGIC: 
    # If payload.is_html is True (HTML Mode), the user is providing the FULL HTML. No wrappers.
    # If payload.is_html is False (Text Mode), we provide the visual editor and wrap it in our premium template.
    if payload.is_html:
        body = content
    else:
        body = wrapper_template.replace("{{MESSAGE_BODY}}", content)
    attachment_stats = get_batch_attachment_stats(db, payload.batch_id)
    if attachment_stats["total_bytes"] > MAX_ATTACHMENTS_TOTAL_BYTES:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "Total attachment size exceeded.",
                "attachment_total_size_exceeded",
                f"Reduce attachments to stay under {MAX_ATTACHMENTS_TOTAL_MB} MB per batch.",
            ),
        )
    attachments = attachment_payloads_for_batch(db, payload.batch_id)
    
    # 4. Dispatch
    try:
        if settings.active_provider == "BREVO":
            success, result = service.send_email(
                to_email=payload.test_email, subject=subject, html_content=body,
                sender_name=settings.brevo_sender_name, sender_email=settings.brevo_sender_email,
                attachments=attachments
            )
        elif settings.active_provider == "GMAIL_SMTP" or settings.active_provider == "SMTP":
            success, result = service.send_email(to_email=payload.test_email, subject=subject, html_content=body, attachments=attachments)
        else:
            success, result = service.send_email(payload.test_email, subject, body, attachments=attachments)
            
        if success:
            return {
                "ok": True,
                "message": f"Test email sent successfully to {payload.test_email}",
                "detail": {
                    "message": f"Test email sent successfully to {payload.test_email}",
                    "code": "test_email_sent"
                }
            }
        else:
            raise HTTPException(
                status_code=500,
                detail=error_detail(
                    "The test email could not be sent.",
                    "test_send_failed",
                    str(result)
                )
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=500,
            detail=error_detail(
                "The test email failed due to a provider error.",
                "test_send_provider_error",
                str(e)
            )
        )

# --- Email Processor ---

def process_single_record_in_batch(
    batch_id: str,
    record_id: int,
    base_subject: str,
    base_raw_message: str,
    payload_is_html: bool,
    wrapper_template: str,
    attachments: Optional[list[dict]] = None,
):
    db = SessionLocal()
    try:
        batch = get_batch_job(db, batch_id)
        if batch and batch.status in {"cancelled", "paused"}:
            return {"ok": False, "status": "skipped", "reason": batch.status}

        record = db.query(models.InvoiceData).filter(
            models.InvoiceData.id == record_id,
            models.InvoiceData.batch_id == batch_id,
        ).first()
        if not record or record.status != "pending":
            return {"ok": False, "status": "skipped", "reason": "not_pending"}

        settings = db.query(models.SystemSettings).first()
        if not settings:
            record.status = "failed"
            record.error_message = "System settings are missing. Open Configuration and save your provider settings."
            db.commit()
            return {"ok": False, "status": "failed", "reason": "missing_settings"}

        service = build_provider_service(settings, db)
        return send_record(
            db=db,
            record=record,
            settings=settings,
            service=service,
            base_subject=base_subject,
            base_raw_message=base_raw_message,
            payload_is_html=payload_is_html,
            wrapper_template=wrapper_template,
            attachments=attachments,
        )
    except Exception as e:
        record = db.query(models.InvoiceData).filter(
            models.InvoiceData.id == record_id,
            models.InvoiceData.batch_id == batch_id,
        ).first()
        if record and record.status == "pending":
            record.status = "failed"
            record.error_message = f"Row failed unexpectedly: {str(e)}"
            db.commit()
        return {"ok": False, "status": "failed", "error": str(e)}
    finally:
        db.close()


def process_email_batch(batch_id: str, custom_subject: str = None, custom_html: str = None, is_html: bool = True, template_type: str = "PROFESSIONAL"):
    db = SessionLocal()
    try:
        batch = get_batch_job(db, batch_id)
        settings = db.query(models.SystemSettings).first()
        if not settings:
            mark_pending_records_for_batch(db, batch_id, "failed", "System settings are missing. Open Configuration and save your provider settings.")
            if batch:
                batch.status = "failed"
                batch.last_error = "System settings are missing."
                db.commit()
            return

        validate_email_provider(settings, db)
        if batch:
            batch.provider = settings.active_provider
        attachment_stats = get_batch_attachment_stats(db, batch_id)
        if attachment_stats["total_bytes"] > MAX_ATTACHMENTS_TOTAL_BYTES:
            message = f"Total attachment size exceeds the allowed {MAX_ATTACHMENTS_TOTAL_MB} MB batch limit."
            mark_pending_records_for_batch(db, batch_id, "failed", message)
            if batch:
                batch.status = "failed"
                batch.last_error = message
                db.commit()
            return

        try:
            _ = build_provider_service(settings, db)
        except Exception as provider_error:
            message = f"Email provider setup failed: {provider_error}"
            mark_pending_records_for_batch(db, batch_id, "failed", message)
            if batch:
                batch.status = "failed"
                batch.last_error = message
                db.commit()
            logger.error("Provider setup failed for batch %s: %s", batch_id, provider_error, exc_info=True)
            return
        
        # Select Base Template and Wrapper
        if template_type == "CREATIVE":
            base_subject = custom_subject or settings.email_template_creative_subject or "An update for you!"
            base_raw_message = custom_html or settings.email_template_creative_html or SAMPLE_MESSAGE_CREATIVE
            wrapper_template = DEFAULT_HTML_TEMPLATE_CREATIVE
        else:
            base_subject = custom_subject or settings.email_template_subject or "Professional Update"
            base_raw_message = custom_html or settings.email_template_html or SAMPLE_MESSAGE
            wrapper_template = DEFAULT_HTML_TEMPLATE

        payload_is_html = is_html if is_html is not None else settings.email_template_is_html
        metadata = parse_batch_metadata(batch)
        validation_snapshot = metadata.get("validation") if isinstance(metadata.get("validation"), dict) else evaluate_batch_validation(db, batch_id, base_subject, base_raw_message)
        dispatch_plan = metadata.get("dispatch_plan") if isinstance(metadata.get("dispatch_plan"), dict) else None

        if batch:
            batch.status = "running"
            batch.last_error = None
            db.commit()

        pending_records = db.query(models.InvoiceData).filter(
            models.InvoiceData.batch_id == batch_id,
            models.InvoiceData.status == "pending"
        ).all()
        record_ids = [record.id for record in pending_records]
        attachments = attachment_payloads_for_batch(db, batch_id)

        now_utc = datetime.datetime.utcnow()
        if dispatch_plan and dispatch_plan.get("enabled"):
            due_slot_idx, due_slot = get_next_due_dispatch_slot(dispatch_plan, now_utc)
            if due_slot is None:
                batch = get_batch_job(db, batch_id)
                if batch:
                    batch.status = "completed"
                    batch.completed_at = now_utc
                    persist_batch_metadata(batch, validation_snapshot, dispatch_plan, metadata.get("delivery"))
                    db.commit()
                return
            if due_slot_idx is None:
                next_slot_at = datetime.datetime.fromisoformat(due_slot["scheduled_for"])
                batch = get_batch_job(db, batch_id)
                if batch:
                    batch.status = "scheduled"
                    batch.scheduled_for = next_slot_at
                    persist_batch_metadata(batch, validation_snapshot, dispatch_plan, metadata.get("delivery"))
                    db.commit()
                return
            slot_count = max(1, int(due_slot.get("count", 1)))
            record_ids = record_ids[:slot_count]
            logger.info(
                "Batch %s pacing slot #%s due. Sending %s row(s) now.",
                batch_id,
                due_slot.get("index"),
                len(record_ids),
            )

        if not record_ids:
            batch = get_batch_job(db, batch_id)
            if batch:
                batch.completed_at = datetime.datetime.utcnow()
                batch.status = "completed"
                batch.last_error = None
                db.commit()
            return

        worker_count = min(MAX_BATCH_WORKERS, len(record_ids))
        logger.info(
            "Processing batch %s with %s pending row(s) using %s worker(s).",
            batch_id,
            len(record_ids),
            worker_count,
        )

        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(
                    process_single_record_in_batch,
                    batch_id,
                    record_id,
                    base_subject,
                    base_raw_message,
                    payload_is_html,
                    wrapper_template,
                    attachments,
                )
                for record_id in record_ids
            ]
            for idx, future in enumerate(as_completed(futures), start=1):
                _ = future.result()
                if idx % 20 == 0:
                    batch = get_batch_job(db, batch_id)
                    if batch and batch.status == "cancelled":
                        mark_pending_records_for_batch(db, batch_id, "failed", "Batch cancelled before all emails were sent.")
                        return
                    if batch and batch.status == "paused":
                        return

        batch = get_batch_job(db, batch_id)
        if batch:
            stats = build_batch_stats(db, batch_id)
            if dispatch_plan and dispatch_plan.get("enabled"):
                due_slot_idx, due_slot = get_next_due_dispatch_slot(dispatch_plan, datetime.datetime.utcnow())
                if due_slot_idx is not None:
                    dispatch_plan["slots"][due_slot_idx]["status"] = "done"
                next_pending = next((slot for slot in dispatch_plan.get("slots", []) if slot.get("status") == "pending"), None)
                if next_pending and stats["pending"] > 0:
                    batch.status = "scheduled"
                    batch.scheduled_for = datetime.datetime.fromisoformat(next_pending["scheduled_for"])
                    batch.completed_at = None
                    batch.last_error = None if stats["failed"] == 0 else f"{stats['failed']} row(s) failed so far."
                else:
                    batch.completed_at = datetime.datetime.utcnow()
                    batch.status = "completed"
                    batch.last_error = None if stats["failed"] == 0 else f"{stats['failed']} row(s) failed."
                    log_audit(db, "batch.completed", "batch", f"Completed batch {batch_id}", batch_id, stats)
            else:
                batch.completed_at = datetime.datetime.utcnow()
                batch.status = "completed"
                batch.last_error = None if stats["failed"] == 0 else f"{stats['failed']} row(s) failed."
                log_audit(db, "batch.completed", "batch", f"Completed batch {batch_id}", batch_id, stats)
            persist_batch_metadata(batch, validation_snapshot, dispatch_plan, metadata.get("delivery"))
            db.commit()
    except Exception as e:
        batch = get_batch_job(db, batch_id)
        pending_records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id, models.InvoiceData.status == "pending").all()
        if pending_records:
            for record in pending_records:
                record.status = "failed"
                record.error_message = f"Batch processing stopped unexpectedly: {str(e)}"
        if batch:
            batch.status = "failed"
            batch.last_error = str(e)
        db.commit()
        logger.error(f"Batch processing error: {str(e)}", exc_info=True)
    finally:
        db.close()

# --- Static Serving (SPA Catch-all MUST be last) ---

if os.path.exists("dist"):
    app.mount("/assets", StaticFiles(directory="dist/assets"), name="assets")

    @app.get("/favicon.svg")
    @app.get("/favicon.ico")
    async def get_favicon():
        for path in ["dist/favicon.svg", "public/favicon.svg"]:
            if os.path.exists(path):
                return FileResponse(path)
        raise HTTPException(status_code=404)

    @app.get("/ikf.png")
    async def get_logo():
        for path in ["dist/ikf.png", str(LOGO_PATH), "public/ikf.png", "ikf.png"]:
            if os.path.exists(path):
                return FileResponse(path)
        raise HTTPException(status_code=404)

    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        if full_path.startswith("api"):
            logger.warning(f"Rejecting API request at catch-all: {full_path}")
            raise HTTPException(status_code=404, detail=f"API route not found: {full_path}")
        
        index_path = os.path.join("dist", "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Frontend build not found.")
