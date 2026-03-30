@echo off
pushd "%~dp0"
echo ==================================================
echo   IKF MailMerge - One-Click Project Refresh
echo ==================================================
echo.

:: 1. Rebuild Frontend
echo [INFO] Rebuilding modern frontend...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed. Fix the code and try again.
    pause
    exit /b
)

:: 2. Restart Backend
echo.
echo [INFO] Restarting background service (PM2)...
call pm2 restart ikf-backend
if %errorlevel% neq 0 (
    echo [WARNING] PM2 restart failed. Attempting setup...
    call pm2 start start_server.py --interpreter python_bin\python.exe --name "ikf-backend"
)

echo.
echo [SUCCESS] Your changes are now live on http://mail-merge.ikf.in/
echo.
pause
