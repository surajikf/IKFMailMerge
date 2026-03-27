import sqlite3
import os

db_path = r'e:\Cursor\Automated Invoice Email System\sql_app.db'
batch_id = '7ec53d47-6e8e-4c34-beae-ed9273f2d0d3'

if not os.path.exists(db_path):
    print(f"Error: Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Reset to pending
cursor.execute("UPDATE invoices SET status='pending', error_message=NULL WHERE batch_id=?", (batch_id,))
conn.commit()
print(f"Updated {cursor.rowcount} rows to pending.")

conn.close()
