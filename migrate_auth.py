import sqlite3
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'sql_app.db')
print(f'Using DB: {db_path}')

conn = sqlite3.connect(db_path)
c = conn.cursor()

migrations = [
    'ALTER TABLE batch_jobs ADD COLUMN user_id INTEGER REFERENCES users(id)',
    'ALTER TABLE invoices ADD COLUMN user_id INTEGER REFERENCES users(id)',
    'ALTER TABLE smtp_accounts ADD COLUMN user_id INTEGER REFERENCES users(id)',
    'ALTER TABLE batch_attachments ADD COLUMN user_id INTEGER REFERENCES users(id)',
    'ALTER TABLE email_templates ADD COLUMN user_id INTEGER REFERENCES users(id)',
]

for sql in migrations:
    try:
        c.execute(sql)
        table = sql.split('TABLE')[1].split('ADD')[0].strip()
        print(f'OK: added user_id to {table}')
    except Exception as e:
        print(f'SKIP (already exists or error): {e}')

conn.commit()
conn.close()
print('Migration complete.')
