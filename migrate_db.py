import sqlite3
import os

db_path = "e:\\Cursor\\Automated Invoice Email System\\sql_app.db"
if not os.path.exists(db_path):
    print(f"Database {db_path} not found.")
else:
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if already exists
        cursor.execute("PRAGMA table_info(settings)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if "email_template_is_html" not in columns:
            cursor.execute("ALTER TABLE settings ADD COLUMN email_template_is_html BOOLEAN DEFAULT 0")
            conn.commit()
            print("Successfully added email_template_is_html column.")
        else:
            print("Column email_template_is_html already exists.")

        if "gmail_client_id" not in columns:
            cursor.execute("ALTER TABLE settings ADD COLUMN gmail_client_id TEXT")
            conn.commit()
            print("Successfully added gmail_client_id column.")
        else:
            print("Column gmail_client_id already exists.")

        if "gmail_client_secret" not in columns:
            cursor.execute("ALTER TABLE settings ADD COLUMN gmail_client_secret TEXT")
            conn.commit()
            print("Successfully added gmail_client_secret column.")
        else:
            print("Column gmail_client_secret already exists.")

        if "smtp_host" not in columns:
            cursor.execute("ALTER TABLE settings ADD COLUMN smtp_host TEXT DEFAULT 'smtp.gmail.com'")
            conn.commit()
            print("Successfully added smtp_host column.")

        if "smtp_port" not in columns:
            cursor.execute("ALTER TABLE settings ADD COLUMN smtp_port INTEGER DEFAULT 465")
            conn.commit()
            print("Successfully added smtp_port column.")

        if "smtp_user" not in columns:
            cursor.execute("ALTER TABLE settings ADD COLUMN smtp_user TEXT")
            conn.commit()
            print("Successfully added smtp_user column.")

        if "smtp_password" not in columns:
            cursor.execute("ALTER TABLE settings ADD COLUMN smtp_password TEXT")
            conn.commit()
            print("Successfully added smtp_password column.")
            
        # Also clean up any corrupted data or ensure at least one settings row exists
        cursor.execute("SELECT COUNT(*) FROM settings")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO settings (active_provider, brevo_sender_email, brevo_sender_name, email_template_subject, email_template_is_html, smtp_host, smtp_port) VALUES ('GMAIL', 'noreply@ikf.in', 'IKF MailMerge', 'Follow up regarding {{Company}}', 0, 'smtp.gmail.com', 465)")
            conn.commit()
            print("Inserted default settings row.")
            
        conn.close()
    except Exception as e:
        print(f"Error: {e}")
