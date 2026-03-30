@echo off
echo ==================================================
echo   IKF MailMerge - NSSM Service Installer
echo ==================================================
echo.

:: 1. Check for nssm.exe
if not exist "nssm.exe" (
    echo [ERROR] nssm.exe NOT found in this folder.
    echo Please download NSSM from https://nssm.cc/download and put nssm.exe here.
    pause
    exit /b
)

:: 2. Identify absolute paths
set "APP_DIR=%~dp0"
set "RUN_SCRIPT=%APP_DIR%service_run.bat"

:: 3. Create service
echo [INFO] Installing "IKF_MailMerge" Service...
nssm install IKF_MailMerge "%RUN_SCRIPT%"
nssm set IKF_MailMerge AppDirectory "%APP_DIR%"
nssm set IKF_MailMerge Description "IKF MailMerge Backend (FastAPI)"
nssm set IKF_MailMerge Start SERVICE_AUTO_START

echo.
echo [SUCCESS] Service installed. 
echo [INFO] To start it, run: nssm start IKF_MailMerge
echo.
pause
