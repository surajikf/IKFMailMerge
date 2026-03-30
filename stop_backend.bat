@echo off
echo ==================================================
echo   IKF MailMerge - Stopping Backend Process
echo ==================================================
echo.

:: 1. Find the PID of the process listening on port 8000
set "PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    set "PID=%%a"
)

if "%PID%"=="" (
    echo [INFO] No backend process found running on Port 8000.
    pause
    exit /b
)

:: 2. Kill the PID
echo [INFO] Stopping process with PID: %PID%...
taskkill /F /PID %PID%

if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] Backend stopped.
) else (
    echo [ERROR] Failed to stop the process.
)

pause
