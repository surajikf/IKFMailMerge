@echo off
echo ==================================================
echo   IKF MailMerge - Workspace Cleanup
echo ==================================================
echo.
echo This will delete redundant development/debug scripts.
set /p confirm="Are you sure? (y/n): "
if /i "%confirm%" neq "y" goto :cancel

del check_actual_db.py 2>nul
del check_db_debug.py 2>nul
del check_db_local.py 2>nul
del check_settings_row.py 2>nul
del debug_db_state.py 2>nul
del debug_db_state_v2.py 2>nul
del debug_tables.py 2>nul
del force_migrate.py 2>nul
del tmp_reset.py 2>nul
del update_branding_db.py 2>nul
del apply_smtp_fix.py 2>nul
del smoke_test.py 2>nul
del uvicorn.err.log 2>nul
del uvicorn.out.log 2>nul

echo.
echo [SUCCESS] Cleanup complete!
pause
exit /b

:cancel
echo [INFO] Cleanup cancelled.
pause
