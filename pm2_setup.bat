@echo off
pushd "%~dp0"
echo ==================================================
echo   IKF MailMerge - PM2 Background Setup
echo ==================================================
echo.

:: 1. Check for PM2
call pm2 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] PM2 not found. Installing now...
    call npm install -g pm2
)

:: 2. Identify paths
set "APP_DIR=%~dp0"
set "PYTHON_EXE=%APP_DIR%python_bin\python.exe"

:: 3. Start with PM2
echo [INFO] Registering backend with PM2...
call pm2 start start_server.py --interpreter "%PYTHON_EXE%" --name "ikf-backend"

:: 4. Ensure it persists after reboot (optional but recommended)
echo [INFO] Saving PM2 state...
call pm2 save

echo.
echo [SUCCESS] Backend is now running in the background!
echo [INFO] You can close this window now.
echo [INFO] Use 'pm2 list' to see status or 'pm2 logs' to see logs.
echo.
pause
