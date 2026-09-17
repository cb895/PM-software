"""
services/email_service.py
Gmail SMTP email service with PDF attachment support.
Uses App Password authentication — no OAuth token refresh needed.
"""
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import List, Optional
from pathlib import Path

from core.config import settings

log = logging.getLogger(__name__)

# Recipients for all document emails
DOCUMENT_RECIPIENTS = [
    "cb@metabolictrack.com",
    "kj@metabolictrack.com",
]


def send_email(
    subject:     str,
    body_html:   str,
    recipients:  List[str] = None,
    attachments: List[dict] = None,   # [{"filename": "...", "path": "..."} or {"filename": "...", "data": bytes}]
    body_text:   Optional[str] = None,
) -> bool:
    """
    Send an email via Gmail SMTP using App Password.
    Returns True on success, False on failure.
    """
    if not settings.gmail_app_password:
        log.warning("Gmail App Password not configured — email not sent.")
        return False

    recipients = recipients or DOCUMENT_RECIPIENTS

    try:
        msg = MIMEMultipart("mixed")
        msg["From"]    = f"MetabolicTrack Lab PM <{settings.gmail_sender}>"
        msg["To"]      = ", ".join(recipients)
        msg["Subject"] = subject

        # Body
        alt = MIMEMultipart("alternative")
        if body_text:
            alt.attach(MIMEText(body_text, "plain"))
        alt.attach(MIMEText(body_html, "html"))
        msg.attach(alt)

        # Attachments
        for att in (attachments or []):
            part = MIMEBase("application", "pdf")
            if "path" in att:
                with open(att["path"], "rb") as f:
                    part.set_payload(f.read())
            elif "data" in att:
                part.set_payload(att["data"])
            encoders.encode_base64(part)
            part.add_header(
                "Content-Disposition",
                f'attachment; filename="{att["filename"]}"'
            )
            msg.attach(part)

        # Send via Gmail SMTP
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(settings.gmail_sender, settings.gmail_app_password)
            server.sendmail(settings.gmail_sender, recipients, msg.as_string())

        log.info(f"Email sent: {subject} → {recipients}")
        return True

    except Exception as e:
        log.error(f"Failed to send email '{subject}': {e}")
        return False
