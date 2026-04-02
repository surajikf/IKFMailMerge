import os.path
import base64
import logging
from email.message import EmailMessage
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from config import TOKEN_PATH

logger = logging.getLogger("gmail_service")

SCOPES = ['https://www.googleapis.com/auth/gmail.send']

class GmailService:
    def __init__(self, token_path=None):
        self.token_path = str(token_path or TOKEN_PATH)
        self.service = self._authenticate()

    def _authenticate(self):
        creds = None
        if os.path.exists(self.token_path):
            creds = Credentials.from_authorized_user_file(self.token_path, SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                    with open(self.token_path, 'w') as token:
                        token.write(creds.to_json())
                    logger.info("Gmail token refreshed successfully.")
                except Exception as e:
                    logger.error("Gmail token refresh failed: %s", e, exc_info=True)
                    raise
            else:
                # In a web/background context we cannot run a local server.
                # The user must have already connected via the Settings page.
                raise Exception("Gmail is not authenticated. Please connect your account in Settings first.")

        return build('gmail', 'v1', credentials=creds)

    def send_email(self, to_email: str, subject: str, body: str, attachments=None):
        message = EmailMessage()
        message.add_alternative(body, subtype='html')
        message['To'] = to_email
        message['From'] = "me"
        message['Subject'] = subject
        for item in (attachments or []):
            mime = str(item.get("mime_type") or "application/octet-stream")
            maintype, subtype = (mime.split("/", 1) + ["octet-stream"])[:2]
            message.add_attachment(
                item.get("content_bytes") or b"",
                maintype=maintype,
                subtype=subtype,
                filename=item.get("filename") or "attachment.bin",
            )

        encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        create_message = {
            'raw': encoded_message
        }
        try:
            send_message = (self.service.users().messages().send(userId="me", body=create_message).execute())
            return True, send_message['id']
        except HttpError as error:
            return False, str(error)

    def verify_connection(self):
        try:
            # Check for Gmail Profile
            profile = self.service.users().getProfile(userId='me').execute()
            return True, f"Gmail Connected: {profile.get('emailAddress')}"
        except Exception as e:
            return False, f"Gmail Connection Error: {str(e)}"
