@echo off
echo ==================================================
echo   Automated Invoice Email System - Standalone Mode
echo ==================================================
echo.

:: Check for Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.9+ 
    pause
    exit /b
)

:: Check for Node
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js.
    pause
    exit /b
)

:: Setup Python Venv if it doesn't exist
if not exist "venv" (
    if not exist ".venv" (
        echo [INFO] Creating Python virtual environment...
        python -m venv .venv
    )
)

:: Activate Python environment
if exist ".venv\Scripts\activate" (
    call .venv\Scripts\activate
) else (
    call venv\Scripts\activate
)

:: Install dependencies
echo [INFO] Installing Python dependencies...
pip install -r requirements.txt

if not exist "node_modules" (
    echo [INFO] Installing Node.js dependencies...
    npm install
)

echo.
echo [INFO] Building frontend for standalone serving...
call npm run build

if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed. Fix the errors above and run again.
    pause
    exit /b
)

echo.
echo [SUCCESS] Starting standalone application
echo [INFO] FastAPI will serve both the API and the built frontend.
python start_server.py

pause
