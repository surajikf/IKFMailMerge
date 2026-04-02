from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime

class InvoiceBase(BaseModel):
    recipient_name: str
    email_address: str
    invoice_amount: str
    due_date: str

class InvoiceCreate(InvoiceBase):
    batch_id: str

class Invoice(InvoiceBase):
    id: int
    batch_id: str
    status: str
    row_data: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    sent_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class SystemSettingsBase(BaseModel):
    active_provider: str = "GMAIL"
    brevo_api_key: Optional[str] = None
    brevo_sender_email: Optional[str] = "noreply@ikf.in"
    brevo_sender_name: Optional[str] = "IKF MailMerge"
    gmail_client_id: Optional[str] = None
    gmail_client_secret: Optional[str] = None
    smtp_host: Optional[str] = "smtp.gmail.com"
    smtp_port: Optional[int] = 465
    smtp_user: Optional[str] = None
    email_template_subject: Optional[str] = "Professional Update: {{Name}}"
    email_template_html: Optional[str] = None
    email_template_creative_subject: Optional[str] = "An exciting update for you, {{Name}}!"
    email_template_creative_html: Optional[str] = None
    active_template_type: Optional[str] = "PROFESSIONAL" # PROFESSIONAL, CREATIVE
    email_template_is_html: bool = True
    active_smtp_name: Optional[str] = None

class SystemSettings(SystemSettingsBase):
    id: int
    updated_at: datetime

    class Config:
        from_attributes = True

class SystemSettingsUpdate(BaseModel):
    active_provider: Optional[str] = None
    brevo_api_key: Optional[str] = None
    brevo_sender_email: Optional[str] = None
    brevo_sender_name: Optional[str] = None
    gmail_client_id: Optional[str] = None
    gmail_client_secret: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    email_template_subject: Optional[str] = None
    email_template_html: Optional[str] = None
    email_template_creative_subject: Optional[str] = None
    email_template_creative_html: Optional[str] = None
    active_template_type: Optional[str] = None
    email_template_is_html: Optional[bool] = None
    active_smtp_name: Optional[str] = None

class CampaignPacingPayload(BaseModel):
    enabled: bool = False
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    slot_minutes: int = 60
    min_per_slot: int = 100
    max_per_slot: int = 200
    randomize: bool = True
    weekdays_only: bool = False
    daily_start_hour: Optional[int] = None
    daily_end_hour: Optional[int] = None


class SendEmailPayload(BaseModel):
    batch_id: str
    template_type: Optional[str] = "PROFESSIONAL" # PROFESSIONAL, CREATIVE
    custom_subject: Optional[str] = None
    custom_html: Optional[str] = None
    is_html: bool = True
    scheduled_for: Optional[datetime] = None
    campaign_pacing: Optional[CampaignPacingPayload] = None


class RecipientUpdatePayload(BaseModel):
    recipient_name: Optional[str] = None
    email_address: Optional[str] = None
    invoice_amount: Optional[str] = None
    due_date: Optional[str] = None


class RecipientSendModePayload(BaseModel):
    mode: str  # single | selected | all_pending
    invoice_id: Optional[int] = None
    invoice_ids: Optional[list[int]] = None
    custom_subject: Optional[str] = None
    custom_html: Optional[str] = None
    is_html: bool = True
    template_type: Optional[str] = "PROFESSIONAL"


class PurgeAllBatchesPayload(BaseModel):
    """Must match exactly; prevents accidental wipes."""
    confirm: str


class RecipientListResponse(BaseModel):
    items: list[Invoice]
    total: int
    pending: int
    success: int
    failed: int
    partial: int

class TestEmailPayload(BaseModel):
    batch_id: str
    test_email: str
    custom_subject: Optional[str] = None
    custom_html: Optional[str] = None
    is_html: bool = True
    template_type: str = "PROFESSIONAL"


class SmtpAccountBase(BaseModel):
    display_name: str
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 465
    smtp_user: str


class SmtpAccountCreate(SmtpAccountBase):
    smtp_password: str
    is_active: bool = False


class SmtpAccountUpdate(BaseModel):
    display_name: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    is_active: Optional[bool] = None


class SmtpAccount(SmtpAccountBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BatchJobBase(BaseModel):
    batch_id: str
    source_filename: Optional[str] = None
    status: str
    provider: Optional[str] = None
    custom_subject: Optional[str] = None
    custom_html: Optional[str] = None
    template_type: str = "PROFESSIONAL"
    is_html: bool = True
    scheduled_for: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    paused_at: Optional[datetime] = None
    last_error: Optional[str] = None
    validation_summary: Optional[str] = None


class BatchJob(BatchJobBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BatchSummary(BaseModel):
    batch: BatchJob
    stats: dict[str, Any]


class BatchAttachment(BaseModel):
    id: int
    batch_id: str
    original_filename: str
    mime_type: Optional[str] = None
    file_size: int
    created_at: datetime

    class Config:
        from_attributes = True


class EmailTemplateBase(BaseModel):
    name: str
    category: str = "General"
    subject: str
    html: str
    is_html: bool = True
    template_type: str = "PROFESSIONAL"


class EmailTemplateCreate(EmailTemplateBase):
    pass


class EmailTemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    html: Optional[str] = None
    is_html: Optional[bool] = None
    template_type: Optional[str] = None
    is_active: Optional[bool] = None


class EmailTemplate(EmailTemplateBase):
    id: int
    version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AuditLog(BaseModel):
    id: int
    action: str
    entity_type: str
    entity_id: Optional[str] = None
    summary: str
    metadata_json: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
