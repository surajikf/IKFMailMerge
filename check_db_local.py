import sqlite3
import os

db_path = "e:\\Cursor\\Automated Invoice Email System\\sql_app.db"
if not os.path.exists(db_path):
    print(f"Database {db_path} not found.")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    tables = ["invoices", "settings"]
    for table in tables:
        print(f"\n--- {table} ---")
        cursor.execute(f"PRAGMA table_info({table})")
        columns = cursor.fetchall()
        for col in columns:
            print(col)
    conn.close()
