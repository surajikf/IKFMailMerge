import sib_api_v3_sdk
from sib_api_v3_sdk.rest import ApiException
import os
from dotenv import load_dotenv

load_dotenv()

class BrevoService:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("BREVO_API_KEY")
        if not self.api_key:
            raise ValueError("Brevo API Key is missing.")
        
        self.configuration = sib_api_v3_sdk.Configuration()
        self.configuration.api_key['api-key'] = self.api_key
        self.api_instance = sib_api_v3_sdk.TransactionalEmailsApi(sib_api_v3_sdk.ApiClient(self.configuration))

    def send_email(self, to_email: str, subject: str, html_content: str, sender_name: str = "IKF Outreach", sender_email: str = "noreply@ikf.in"):
        sender = {"name": sender_name, "email": sender_email}
        to = [{"email": to_email}]
        reply_to = {"email": sender_email, "name": sender_name}
        
        send_smtp_email = sib_api_v3_sdk.SendSmtpEmail(
            to=to,
            reply_to=reply_to,
            headers={"Some-Custom-Name": "unique-id-1234"},
            html_content=html_content,
            sender=sender,
            subject=subject
        )

        try:
            api_response = self.api_instance.send_transac_email(send_smtp_email)
            return True, api_response.message_id
        except ApiException as e:
            return False, str(e)
