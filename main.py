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
import difflib
import io
import base64
import uuid
import traceback
import threading
from typing import Optional
from urllib.parse import quote
from sqlalchemy.orm import Session
from sqlalchemy import text
import pandas as pd

import models
import schemas
from config import ADMIN_ACCESS_TOKEN, ALLOWED_ORIGINS, APP_ENV, APP_PORT, CREDENTIALS_PATH, DATA_DIR, LOGO_PATH, TOKEN_PATH
from database import SessionLocal, engine, get_db
from security import decrypt_secret, encrypt_secret, is_encrypted_secret

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api")

# Initialize Database
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="IKF MailMerge API")
WORKER_POLL_SECONDS = 2
worker_shutdown_event = threading.Event()
worker_thread: Optional[threading.Thread] = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=bool(ALLOWED_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def admin_access_middleware(request: Request, call_next):
    protected_prefixes = (
        "/api/settings",
        "/api/smtp_accounts",
        "/api/templates",
        "/api/send_emails",
        "/api/send_test_email",
        "/api/batches",
    )
    if ADMIN_ACCESS_TOKEN and request.url.path.startswith(protected_prefixes):
        supplied_token = request.headers.get("X-Admin-Key", "").strip()
        if supplied_token != ADMIN_ACCESS_TOKEN:
            return JSONResponse(
                status_code=401,
                content={
                    "ok": False,
                    "detail": error_detail(
                        "Admin access token is missing or invalid.",
                        "admin_auth_failed",
                        "Provide a valid X-Admin-Key header to use protected endpoints."
                    )
                }
            )
    return await call_next(request)


def error_detail(message: str, code: str, hint: Optional[str] = None):
    payload = {"message": message, "code": code}
    if hint:
        payload["hint"] = hint
    return payload


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
    <style>
        body { margin: 0; padding: 0; background-color: #f4f7fa; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid #e1e8ed; }
        .header { background-color: #ffffff; padding: 30px; text-align: center; border-bottom: 3px solid #6366f1; }
        .logo { max-width: 140px; height: auto; }
        .content { padding: 40px; color: #333333; line-height: 1.6; font-size: 16px; }
        .footer { padding: 25px; text-align: center; background-color: #f8fafc; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0; }
        .highlight { color: #6366f1; font-weight: 600; }
        .footer-link { color: #6366f1; text-decoration: none; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="__LOGO_SRC__" alt="Knowledge Factory Logo" class="logo">
        </div>
        <div class="content">
            {{MESSAGE_BODY}}
        </div>
        <div class="footer">
            <p><strong>Knowledge Factory</strong> | craft | care | amplify</p>
            <p style="margin-top: 10px; opacity: 0.7;">© 2026 Knowledge Factory. All rights reserved.</p>
        </div>
    </div>
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
    <style>
        body { margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Outfit', 'Inter', sans-serif; }
        .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 50px 20px; text-align: center; }
        .logo { max-width: 150px; height: auto; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1)); }
        .content { padding: 45px; color: #1f2937; line-height: 1.7; font-size: 17px; }
        .footer { padding: 35px; text-align: center; background-color: #111827; color: #9ca3af; font-size: 13px; }
        .highlight { color: #8b5cf6; font-weight: 700; }
        .action-box { background-color: #f9fafb; border-radius: 12px; padding: 25px; margin: 25px 0; border-left: 5px solid #8b5cf6; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
        .footer-link { color: #a78bfa; text-decoration: none; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="__LOGO_SRC__" alt="Knowledge Factory Logo" class="logo">
        </div>
        <div class="content">
            {{MESSAGE_BODY}}
        </div>
        <div class="footer">
            <p style="color: #ffffff; font-weight: 700; font-size: 16px; margin-bottom: 8px;">Knowledge Factory</p>
            <p>craft | care | amplify</p>
            <p style="opacity: 0.6;">© 2026 Knowledge Factory. All rights reserved.</p>
        </div>
    </div>
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
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value.strip()))


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


def get_batch_job(db: Session, batch_id: str) -> Optional[models.BatchJob]:
    return db.query(models.BatchJob).filter(models.BatchJob.batch_id == batch_id).first()


def ensure_batch_job(db: Session, batch_id: str, source_filename: Optional[str] = None) -> models.BatchJob:
    batch = get_batch_job(db, batch_id)
    if batch:
        if source_filename and not batch.source_filename:
            batch.source_filename = source_filename
        return batch

    batch = models.BatchJob(batch_id=batch_id, source_filename=source_filename, status="draft")
    db.add(batch)
    db.flush()
    return batch


def get_row_context(record: models.InvoiceData) -> dict:
    context = json.loads(record.row_data) if record.row_data else {}
    formatted_date = record.due_date
    try:
        if record.due_date:
            dt = pd.to_datetime(record.due_date)
            formatted_date = dt.strftime('%d/%m/%y')
    except Exception:
        pass

    context.update({
        "Name": record.recipient_name,
        "Recipient": record.recipient_name,
        "Amount": record.invoice_amount,
        "Value": record.invoice_amount,
        "Invoice Amount": record.invoice_amount,
        "Due Date": formatted_date,
        "Date": formatted_date,
        "Email": record.email_address,
    })
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

    return {
        "ok_to_send": not unresolved_variables and not invalid_rows,
        "record_count": len(records),
        "duplicate_recipients": sorted(duplicate_recipients),
        "duplicate_count": len(duplicate_recipients),
        "unresolved_variables": unresolved_variables,
        "invalid_rows": invalid_rows,
        "missing_name_rows": missing_name_rows,
        "issues": issues,
    }


def build_batch_stats(db: Session, batch_id: str) -> dict:
    records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id).all()
    total = len(records)
    success = len([record for record in records if record.status == "success"])
    failed = len([record for record in records if record.status == "failed"])
    partial = len([record for record in records if record.status == "partial"])
    pending = len([record for record in records if record.status == "pending"])
    completion_rate = round((success / total) * 100, 2) if total else 0
    return {
        "total": total,
        "success": success,
        "failed": failed,
        "partial": partial,
        "pending": pending,
        "completion_rate": completion_rate,
    }


def update_job_validation_summary(db: Session, batch: models.BatchJob):
    if not batch.custom_subject or not batch.custom_html:
        return
    batch.validation_summary = json.dumps(evaluate_batch_validation(db, batch.batch_id, batch.custom_subject, batch.custom_html))


def claim_next_batch_job(db: Session) -> Optional[models.BatchJob]:
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
            .filter(models.BatchJob.status == "scheduled", models.BatchJob.scheduled_for <= now)
            .order_by(models.BatchJob.scheduled_for.asc(), models.BatchJob.created_at.asc())
            .first()
        )
    if not candidate:
        return None
    candidate.status = "running"
    if not candidate.started_at:
        candidate.started_at = now
    candidate.paused_at = None
    candidate.cancelled_at = None
    db.commit()
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
    columns = df.columns.tolist()
    # Sample up to 10 rows for deeper analysis
    sample = df.head(10).astype(str).apply(lambda x: x.str.strip())

    # 1. EMAIL DETECTION (Highest confidence: Regex)
    email_regex = r"[^@\s]+@[^@\s]+\.[^@\s]+"
    for col in columns:
        if sample[col].apply(lambda x: bool(re.search(email_regex, x))).any():
            recommended["email"] = col
            break

    # 2. DATE DETECTION (Pattern Matching + pd.to_datetime)
    date_patterns = [
        r'\d{2,4}[-/\.]\d{1,2}[-/\.]\d{1,2}', # ISO/General
        r'\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}', # US/UK
    ]
    for col in columns:
        if col == recommended["email"]: continue
        if any(sample[col].apply(lambda x: any(re.search(p, x) for p in date_patterns))):
            recommended["date"] = col
            break

    # 3. AMOUNT DETECTION (Numeric, not primary keys)
    for col in columns:
        if col in [recommended["email"], recommended["date"]]: continue
        numeric_vals = pd.to_numeric(sample[col], errors='coerce')
        if not numeric_vals.isna().all():
            col_lower = str(col).lower()
            # Heuristic: Avoid ID, Code, Phone columns for 'Amount'
            if not any(k in col_lower for k in ["id", "code", "phone", "mobile", "zip", "no"]):
                recommended["amount"] = col
                break

    # 4. NAME DETECTION (Heuristic: Non-numeric strings, reasonable length)
    for col in columns:
        if col in [recommended["email"], recommended["date"], recommended["amount"]]: continue
        col_lower = str(col).lower()
        # Avoid IDs and system fields
        if any(k in col_lower for k in ["id", "code", "index", "status", "type"]): continue
        
        # Check if values look like names/entities
        is_name_like = sample[col].apply(lambda x: 3 <= len(x) <= 60 and not x.replace('.', '').replace('-', '').isnumeric())
        if is_name_like.all():
            recommended["name"] = col
            break

    return recommended


def substitute_variables(template: str, context: dict) -> str:
    if not template:
        return ""
    
    # Normalize context keys: lowercase, stripped, and replacing spaces/underscores/hyphens with empty string
    def normalize(s):
        return re.sub(r'[\s_\-]', '', str(s).lower())

    normalized_context = {normalize(k): v for k, v in context.items()}
    keys = list(normalized_context.keys())

    def find_best_match(var_name):
        norm_var = normalize(var_name)
        # 1. Direct match on normalized keys
        if norm_var in normalized_context:
            return normalized_context[norm_var]
        
        # 2. Smart aliases
        aliases = {
            "name": ["recipientname", "clientname", "customername", "contact"],
            "amount": ["invoiceamount", "total", "value", "price"],
            "date": ["duedate", "paymentdate", "schedule"]
        }
        for main_key, alt_list in aliases.items():
            if norm_var == main_key or norm_var in alt_list:
                for alt in [main_key] + alt_list:
                    if alt in normalized_context:
                        return normalized_context[alt]
        
        # 3. Difflib close matches on normalized keys
        matches = difflib.get_close_matches(norm_var, keys, n=1, cutoff=0.7)
        if matches:
            return normalized_context[matches[0]]
        return None

    pattern = r"\{\{([^{}]+?)\}\}"
    
    def replace_match(match):
        raw_val = match.group(1).strip()
        best_val = find_best_match(raw_val)
        if best_val is not None:
            return str(best_val)
        return match.group(0) 

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
    }


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
def get_settings(db: Session = Depends(get_db)):
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
    return settings

@app.post("/api/settings", response_model=schemas.SystemSettings)
def update_settings(payload: schemas.SystemSettingsUpdate, db: Session = Depends(get_db)):
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
    return settings


@app.get("/api/smtp_accounts", response_model=list[schemas.SmtpAccount])
def get_smtp_accounts(db: Session = Depends(get_db)):
    settings = db.query(models.SystemSettings).first()
    import_legacy_smtp_account_if_needed(db, settings)

    accounts = db.query(models.SmtpAccount).order_by(models.SmtpAccount.created_at.asc()).all()
    if accounts and not any(account.is_active for account in accounts):
        active_account = ensure_single_active_smtp_account(db, accounts[0].id)
        sync_legacy_smtp_fields(settings, active_account)
        db.commit()
        accounts = db.query(models.SmtpAccount).order_by(models.SmtpAccount.created_at.asc()).all()

    return accounts


@app.post("/api/smtp_accounts", response_model=schemas.SmtpAccount)
def create_smtp_account(payload: schemas.SmtpAccountCreate, db: Session = Depends(get_db)):
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
def update_smtp_account(account_id: int, payload: schemas.SmtpAccountUpdate, db: Session = Depends(get_db)):
    account = db.query(models.SmtpAccount).filter(models.SmtpAccount.id == account_id).first()
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
def activate_smtp_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(models.SmtpAccount).filter(models.SmtpAccount.id == account_id).first()
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
def delete_smtp_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(models.SmtpAccount).filter(models.SmtpAccount.id == account_id).first()
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
def list_templates(db: Session = Depends(get_db)):
    return (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.is_active.is_(True))
        .order_by(models.EmailTemplate.updated_at.desc())
        .all()
    )


@app.post("/api/templates", response_model=schemas.EmailTemplate)
def create_template(payload: schemas.EmailTemplateCreate, db: Session = Depends(get_db)):
    validate_template_fields(payload.name, payload.subject, payload.html)
    latest = (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.name == payload.name)
        .order_by(models.EmailTemplate.version.desc())
        .first()
    )
    version = (latest.version + 1) if latest else 1
    template = models.EmailTemplate(
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
def update_template(template_id: int, payload: schemas.EmailTemplateUpdate, db: Session = Depends(get_db)):
    template = db.query(models.EmailTemplate).filter(models.EmailTemplate.id == template_id).first()
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
def delete_template(template_id: int, db: Session = Depends(get_db)):
    template = db.query(models.EmailTemplate).filter(models.EmailTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail=error_detail("Template not found.", "template_not_found", "Refresh the page and try again."))
    template.is_active = False
    log_audit(db, "template.archived", "template", f"Archived template {template.name}", str(template_id))
    db.commit()
    return {"ok": True}


@app.get("/api/batches", response_model=list[schemas.BatchJob])
def list_batches(db: Session = Depends(get_db)):
    return db.query(models.BatchJob).order_by(models.BatchJob.updated_at.desc()).limit(50).all()


@app.get("/api/batches/{batch_id}", response_model=schemas.BatchSummary)
def get_batch_summary(batch_id: str, db: Session = Depends(get_db)):
    batch = get_batch_job(db, batch_id)
    if not batch:
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
def pause_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = get_batch_job(db, batch_id)
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
def resume_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = get_batch_job(db, batch_id)
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
def cancel_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = get_batch_job(db, batch_id)
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
def retry_failed_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = get_batch_job(db, batch_id)
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
    if not settings or not settings.gmail_client_id or not settings.gmail_client_secret:
        raise HTTPException(status_code=400, detail="Please save your Gmail Client ID and Client Secret first.")
    
    from google_auth_oauthlib.flow import Flow
    SCOPES = ['https://www.googleapis.com/auth/gmail.send']
    
    redirect_uri = build_gmail_redirect_uri(request)
    
    client_config = {
        "web": {
            "client_id": settings.gmail_client_id,
            "client_secret": settings.gmail_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri]
        }
    }
    
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
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")
        
    from google_auth_oauthlib.flow import Flow
    SCOPES = ['https://www.googleapis.com/auth/gmail.send']
    
    client_config = {
        "web": {
            "client_id": settings.gmail_client_id,
            "client_secret": settings.gmail_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [build_gmail_redirect_uri(request)]
        }
    }

    cookie_state = request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)
    if not state or not cookie_state or state != cookie_state:
        response = RedirectResponse(url="/settings?auth=failed&error=Invalid%20OAuth%20state")
        response.delete_cookie(GMAIL_OAUTH_STATE_COOKIE, path="/")
        return response
    
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=build_gmail_redirect_uri(request)
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

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
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
        if len(contents) == 0:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "The uploaded file is empty.",
                    "file_empty",
                    "Export the sheet again and make sure it contains data rows."
                )
            )

        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents))
        elif filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "Unsupported file format.",
                    "file_type_unsupported",
                    "Upload a CSV or XLSX file."
                )
            )
            
        df = df.fillna("").astype(str)
        
        if df.empty or len(df.columns) == 0:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "The uploaded file appears to be empty.",
                    "file_has_no_rows",
                    "Make sure the sheet contains headers and at least one data row."
                )
            )
            
        return {
            "columns": [str(c) for c in df.columns.tolist()],
            "sample_data": df.head(3).to_dict(orient="records"),
            "recommended_mapping": heuristic_column_discovery(df)
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Upload error: {e}")
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
    db: Session = Depends(get_db)
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

        if len(contents) == 0:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "The uploaded file is empty.",
                    "process_file_empty",
                    "Choose a file that contains invoice rows."
                )
            )

        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents))
        elif filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "Unsupported file format.",
                    "process_file_type_unsupported",
                    "Upload a CSV or XLSX file."
                )
            )
        
        df = df.fillna("").astype(str)
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
        batch = ensure_batch_job(db, batch_id, file.filename)
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
        logger.error(f"Processing error: {e}")
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
def send_emails(payload: schemas.SendEmailPayload, db: Session = Depends(get_db)):
    validate_send_payload(payload.batch_id, payload.custom_subject, payload.custom_html)
    records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == payload.batch_id, models.InvoiceData.status == "pending").all()
    if not records:
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
    validation = evaluate_batch_validation(db, payload.batch_id, payload.custom_subject or "", payload.custom_html or "")
    if not validation["ok_to_send"]:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "This batch has blocking validation issues.",
                "batch_validation_failed",
                "Resolve unresolved placeholders or invalid rows before launching the send."
            )
        )

    batch = ensure_batch_job(db, payload.batch_id)
    batch.provider = settings.active_provider
    batch.custom_subject = payload.custom_subject
    batch.custom_html = payload.custom_html
    batch.template_type = payload.template_type or "PROFESSIONAL"
    batch.is_html = payload.is_html
    batch.last_error = None
    batch.validation_summary = json.dumps(validation)
    batch.scheduled_for = payload.scheduled_for
    batch.status = "scheduled" if payload.scheduled_for and payload.scheduled_for > datetime.datetime.utcnow() else "queued"
    log_audit(
        db,
        "batch.queued" if batch.status == "queued" else "batch.scheduled",
        "batch",
        f"{'Queued' if batch.status == 'queued' else 'Scheduled'} batch {payload.batch_id}",
        payload.batch_id,
        {"provider": settings.active_provider, "scheduled_for": payload.scheduled_for.isoformat() if payload.scheduled_for else None},
    )
    db.commit()
    ensure_worker_running()
    return {
        "ok": True,
        "message": "Email sending has been queued." if batch.status == "queued" else "Email sending has been scheduled.",
        "batch_status": batch.status,
        "validation": validation,
        "detail": {
            "message": "Email sending has started in the background." if batch.status == "queued" else "Email sending has been scheduled.",
            "code": "send_started" if batch.status == "queued" else "send_scheduled"
        }
    }

@app.post("/api/send_test_email")
def send_test_email(payload: schemas.TestEmailPayload, db: Session = Depends(get_db)):
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
    
    # 4. Dispatch
    try:
        if settings.active_provider == "BREVO":
            success, result = service.send_email(
                to_email=payload.test_email, subject=subject, html_content=body,
                sender_name=settings.brevo_sender_name, sender_email=settings.brevo_sender_email
            )
        elif settings.active_provider == "GMAIL_SMTP" or settings.active_provider == "SMTP":
            success, result = service.send_email(to_email=payload.test_email, subject=subject, html_content=body)
        else:
            success, result = service.send_email(payload.test_email, subject, body)
            
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

def process_email_batch(batch_id: str, custom_subject: str = None, custom_html: str = None, is_html: bool = True, template_type: str = "PROFESSIONAL"):
    from gmail_service import GmailService
    from brevo_service import BrevoService
    from smtp_service import SmtpService
    
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
        active_smtp_account = get_active_smtp_account(db, settings) if settings.active_provider in {"GMAIL_SMTP", "SMTP"} else None
        if batch:
            batch.provider = settings.active_provider

        try:
            if settings.active_provider == "BREVO":
                service = BrevoService(api_key=settings.brevo_api_key)
            elif settings.active_provider in {"GMAIL_SMTP", "SMTP"}:
                service = SmtpService(
                    host=active_smtp_account.smtp_host,
                    port=active_smtp_account.smtp_port,
                    user=active_smtp_account.smtp_user,
                    password=decrypt_secret(active_smtp_account.smtp_password),
                )
            else:
                service = GmailService()
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
        if batch:
            batch.status = "running"
            batch.last_error = None
            db.commit()

        records = db.query(models.InvoiceData).filter(models.InvoiceData.batch_id == batch_id, models.InvoiceData.status == "pending").all()
        for record in records:
            db.refresh(record)
            batch = get_batch_job(db, batch_id)
            if batch and batch.status == "cancelled":
                mark_pending_records_for_batch(db, batch_id, "failed", "Batch cancelled before all emails were sent.")
                return
            if batch and batch.status == "paused":
                return

            context = get_row_context(record)
            subject = substitute_variables(base_subject, context)
            content = substitute_variables(base_raw_message, context)
            if payload_is_html:
                body = content
            else:
                body = wrapper_template.replace("{{MESSAGE_BODY}}", content)
            recipients = [e.strip() for e in record.email_address.split(",") if e.strip()]
            if not recipients:
                record.status = "failed"
                record.error_message = "No valid recipient email addresses were found for this row."
                db.commit()
                continue
            
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
                                to_email=email, subject=subject, html_content=body,
                                sender_name=settings.brevo_sender_name, sender_email=settings.brevo_sender_email
                            )
                        elif settings.active_provider in {"GMAIL_SMTP", "SMTP"}:
                            success, result = service.send_email(to_email=email, subject=subject, html_content=body)
                        else:
                            success, result = service.send_email(email, subject, body)
                        
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
            elif success_count > 0:
                record.status = "partial"
                record.error_message = f"Partial success ({success_count}/{len(recipients)}). Errors: {'; '.join(errors)}"
            else:
                record.status = "failed"
                record.error_message = "; ".join(errors)
            
            db.commit()

        batch = get_batch_job(db, batch_id)
        if batch:
            stats = build_batch_stats(db, batch_id)
            batch.validation_summary = json.dumps(evaluate_batch_validation(db, batch_id, base_subject, base_raw_message))
            batch.completed_at = datetime.datetime.utcnow()
            batch.status = "completed"
            batch.last_error = None if stats["failed"] == 0 else f"{stats['failed']} row(s) failed."
            log_audit(db, "batch.completed", "batch", f"Completed batch {batch_id}", batch_id, stats)
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
            raise HTTPException(status_code=404, detail="API route not found")
        
        index_path = os.path.join("dist", "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Frontend build not found.")
