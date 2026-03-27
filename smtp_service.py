import smtplib
from email.message import EmailMessage

class SmtpService:
    def __init__(self, host, port, user, password):
        self.host = host
        self.port = port
        self.user = user
        self.password = password

    def send_email(self, to_email: str, subject: str, html_content: str):
        if not self.host or not self.port or not self.user or not self.password:
            return False, "SMTP configuration incomplete. Please check your settings."
            
        msg = EmailMessage()
        msg.set_content(html_content, subtype='html')
        msg['Subject'] = subject
        msg['From'] = self.user
        msg['To'] = to_email

        try:
            # If port is 465 (SMTPS), use SMTP_SSL. Otherwise use SMTP + STARTTLS.
            if int(self.port) == 465:
                # Set a reasonable timeout for network calls
                with smtplib.SMTP_SSL(self.host, int(self.port), timeout=10) as server:
                    server.login(self.user, self.password)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(self.host, int(self.port), timeout=10) as server:
                    server.starttls()
                    server.login(self.user, self.password)
                    server.send_message(msg)
            return True, "Sent"
        except Exception as e:
            return False, str(e)
