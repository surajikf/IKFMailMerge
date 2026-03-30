@echo off
:: Ensure we are in the correct directory regardless of how it's called
cd /d "%~dp0"

set "PY_PATH=python_bin\python.exe"

if not exist "%PY_PATH%" (
    echo [ERROR] %PY_PATH% not found!
    exit /b 1
)

:: Run the server without pause (NSSM handles logging and restarts)
"%PY_PATH%" start_server.py
