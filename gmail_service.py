import os.path
import base64
from email.message import EmailMessage
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from config import CREDENTIALS_PATH, TOKEN_PATH

SCOPES = ['https://www.googleapis.com/auth/gmail.send']

class GmailService:
    def __init__(self, credentials_path=None, token_path=None):
        self.credentials_path = str(credentials_path or CREDENTIALS_PATH)
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
                except Exception as e:
                    raise Exception(f"Failed to refresh Gmail token: {str(e)}")
            else:
                # IMPORTANT: In a web/background context, we cannot run_local_server.
                # The user must have already connected via the Settings page.
                raise Exception("Gmail is not authenticated. Please connect your account in Settings first.")
                
        return build('gmail', 'v1', credentials=creds)

    def send_email(self, to_email: str, subject: str, body: str):
        message = EmailMessage()
        message.add_alternative(body, subtype='html')
        message['To'] = to_email
        message['From'] = "me"
        message['Subject'] = subject

        encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        create_message = {
            'raw': encoded_message
        }
        try:
            send_message = (self.service.users().messages().send(userId="me", body=create_message).execute())
            return True, send_message['id']
        except HttpError as error:
            return False, str(error)
