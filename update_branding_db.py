import sqlite3
import os

db_path = "e:\\Cursor\\Automated Invoice Email System\\sql_app.db"
if not os.path.exists(db_path):
    print(f"Database {db_path} not found.")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("UPDATE settings SET brevo_sender_name = 'IKF MailMerge' WHERE brevo_sender_name = 'IKF Outreach'")
    conn.commit()
    print(f"Updated {cursor.rowcount} rows.")
    conn.close()
