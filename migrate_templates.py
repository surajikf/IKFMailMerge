import sqlite3
import os

db_path = 'sql_app.db'
if not os.path.exists(db_path):
    print(f"Database {db_path} not found.")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    columns_to_add = [
        ("email_template_creative_subject", "TEXT"),
        ("email_template_creative_html", "TEXT"),
        ("active_template_type", "TEXT"),
        ("email_template_subject", "TEXT"), # Just in case they were lost
        ("email_template_html", "TEXT"),
        ("gmail_client_id", "TEXT"),
        ("gmail_client_secret", "TEXT"),
        ("smtp_host", "TEXT"),
        ("smtp_port", "INTEGER"),
        ("smtp_user", "TEXT"),
        ("smtp_password", "TEXT")
    ]

    for col_name, col_type in columns_to_add:
        try:
            cursor.execute(f"ALTER TABLE settings ADD COLUMN {col_name} {col_type}")
            print(f"Added column: {col_name}")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e).lower():
                print(f"Column already exists: {col_name}")
            else:
                print(f"Error adding {col_name}: {e}")

    conn.commit()
    conn.close()
    print("Migration complete.")
