import os
import shutil

TO_DELETE = [
    "check_actual_db.py",
    "check_db_debug.py",
    "check_db_local.py",
    "check_settings_row.py",
    "debug_db_state.py",
    "debug_db_state_v2.py",
    "debug_tables.py",
    "force_migrate.py",
    "tmp_reset.py",
    "update_branding_db.py",
    "apply_smtp_fix.py",
    "smoke_test.py",
    "uvicorn.err.log",
    "uvicorn.out.log"
]

def cleanup():
    print("IKF MailMerge - Workspace Cleanup")
    print("-" * 30)
    
    for item in TO_DELETE:
        if os.path.exists(item):
            try:
                if os.path.isfile(item):
                    os.remove(item)
                    print(f"[DELETED] File: {item}")
                elif os.path.isdir(item):
                    shutil.rmtree(item)
                    print(f"[DELETED] Dir:  {item}")
            except Exception as e:
                print(f"[ERROR] Could not delete {item}: {e}")
        else:
            print(f"[SKIP] Not found: {item}")
            
    print("-" * 30)
    print("Cleanup complete!")

if __name__ == "__main__":
    confirm = input("This will delete redundant development scripts and logs. Proceed? (y/n): ")
    if confirm.lower() == 'y':
        cleanup()
    else:
        print("Cleanup cancelled.")
