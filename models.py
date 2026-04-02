from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey
from sqlalchemy.orm import relationship
from database import Base
import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=True)
    google_id = Column(String, nullable=True, index=True)
    is_approved = Column(Boolean, default=False)
    role = Column(String, default="user") # 'admin' or 'user'
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    invoices = relationship("InvoiceData", back_populates="user")
    smtp_accounts = relationship("SmtpAccount", back_populates="user")
    batch_jobs = relationship("BatchJob", back_populates="user")
    batch_attachments = relationship("BatchAttachment", back_populates="user")

class InvoiceData(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    batch_id = Column(String, index=True)
    recipient_name = Column(String, index=True)
    email_address = Column(String, index=True)
    invoice_amount = Column(String)
    due_date = Column(String)
    row_data = Column(String, nullable=True) # JSON string of all row columns
    status = Column(String, default="pending") # pending, success, failed, partial
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    sent_at = Column(DateTime, nullable=True)
    user = relationship("User", back_populates="invoices")

class SystemSettings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    active_provider = Column(String, default="GMAIL") # GMAIL, BREVO
    brevo_api_key = Column(String, nullable=True)
    brevo_sender_email = Column(String, default="noreply@ikf.in")
    brevo_sender_name = Column(String, default="IKF MailMerge")
    email_template_subject = Column(String, default="Professional Update: {{Name}}")
    email_template_html = Column(String, nullable=True) # Default will be SAMPLE_MESSAGE
    email_template_creative_subject = Column(String, default="An exciting update for you, {{Name}}!")
    email_template_creative_html = Column(String, nullable=True)
    active_template_type = Column(String, default="PROFESSIONAL") # PROFESSIONAL, CREATIVE
    gmail_client_id = Column(String, nullable=True)
    gmail_client_secret = Column(String, nullable=True)
    smtp_host = Column(String, default="smtp.gmail.com")
    smtp_port = Column(Integer, default=465)
    smtp_user = Column(String, nullable=True)
    smtp_password = Column(String, nullable=True)
    email_template_is_html = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class SmtpAccount(Base):
    __tablename__ = "smtp_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    display_name = Column(String, nullable=False)
    smtp_host = Column(String, default="smtp.gmail.com")
    smtp_port = Column(Integer, default=465)
    smtp_user = Column(String, nullable=False, index=True)
    smtp_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    user = relationship("User", back_populates="smtp_accounts")


class BatchJob(Base):
    __tablename__ = "batch_jobs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    batch_id = Column(String, unique=True, index=True)
    source_filename = Column(String, nullable=True)
    status = Column(String, default="draft")  # draft, queued, scheduled, running, paused, cancelled, completed, failed
    provider = Column(String, nullable=True)
    custom_subject = Column(Text, nullable=True)
    custom_html = Column(Text, nullable=True)
    template_type = Column(String, default="PROFESSIONAL")
    is_html = Column(Boolean, default=True)
    scheduled_for = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    paused_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    validation_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    user = relationship("User", back_populates="batch_jobs")


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String, default="General")
    subject = Column(Text, nullable=False)
    html = Column(Text, nullable=False)
    is_html = Column(Boolean, default=True)
    template_type = Column(String, default="PROFESSIONAL")
    version = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String, index=True)
    entity_type = Column(String, index=True)
    entity_id = Column(String, nullable=True)
    summary = Column(String, nullable=False)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class BatchAttachment(Base):
    __tablename__ = "batch_attachments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    batch_id = Column(String, index=True, nullable=False)
    original_filename = Column(String, nullable=False)
    stored_filename = Column(String, nullable=False)
    mime_type = Column(String, nullable=True)
    file_size = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    user = relationship("User", back_populates="batch_attachments")
