@echo off
echo ==================================================
echo   IKF MailMerge - Standalone Production Mode
echo ==================================================
echo.

:: 1. Verify environment
echo [INFO] Starting IKF MailMerge...

:: 2. Identify the local Python (Prioritize Portable No-Install)
set "PY_PATH="
if exist "python_bin\python.exe" (
    set "PY_PATH=python_bin\python.exe"
) else if exist ".venv\Scripts\python.exe" (
    set "PY_PATH=.venv\Scripts\python.exe"
) else if exist "venv\Scripts\python.exe" (
    set "PY_PATH=venv\Scripts\python.exe"
)

if "%PY_PATH%"=="" (
    echo [ERROR] Virtual environment NOT found in this folder.
    echo Please make sure the .venv or venv folder exists.
    pause
    exit /b
)

echo [INFO] Using virtual environment: %PY_PATH%

:: 3. Check for Node (Required for Frontend)
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js.
    pause
    exit /b
)

:: 4. Build Frontend
echo [INFO] Building modern frontend...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed.
    pause
    exit /b
)

:: 5. Start Backend
echo.
echo [SUCCESS] Starting IKF MailMerge Monolith on Port 8000
echo [INFO] Serving API + React SPA...
"%PY_PATH%" start_server.py

pause
