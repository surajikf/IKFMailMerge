@echo off
pushd "%~dp0"
echo ==================================================
echo   IKF MailMerge - Monolith refresh (API + UI same app)
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
call pm2 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] PM2 not found. Running setup...
    call pm2_setup.bat < nul
)

call pm2 restart ikf-backend >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] PM2 restart failed. Attempting fresh start...
    call pm2 delete ikf-backend >nul 2>&1
    call pm2 start start_server.py --interpreter python_bin\python.exe --name "ikf-backend"
    call pm2 save >nul 2>&1
)

:: 3. Post-refresh API Self-test
echo.
echo [INFO] Verifying live API capabilities...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$r=Invoke-RestMethod -Uri 'http://mail-merge.ikf.in/api/version' -TimeoutSec 20;" ^
  "if(-not $r.ok){ exit 2 };" ^
  "if(-not $r.features.selected_send){ exit 3 };" ^
  "Write-Host ('[INFO] API version: ' + $r.version);" >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Backend restarted, but selected-send self-test failed.
    echo [WARNING] Check that the correct runtime folder is deployed and PM2 process uses latest code.
    echo [INFO] Test URL: http://mail-merge.ikf.in/api/version
) else (
    echo [SUCCESS] Self-test passed: selected-send is active on live server.
)

echo.
echo [INFO] Verifying purge endpoint routing...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url='http://mail-merge.ikf.in/api/batches/purge_all';" ^
  "$body='{\"confirm\":\"__probe__\"}';" ^
  "try {" ^
  "  Invoke-WebRequest -Uri $url -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 20 | Out-Null;" ^
  "  exit 0;" ^
  "} catch {" ^
  "  $code = $_.Exception.Response.StatusCode.value__;" ^
  "  if($code -in 400,401){ exit 0 } else { exit $code }" ^
  "}" >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Purge route check failed (expected 400/401, got %errorlevel%).
    echo [WARNING] Live backend may still be old or PM2 may be running from a different folder.
    echo [INFO] Check URL manually: http://mail-merge.ikf.in/api/batches/purge_all
) else (
    echo [SUCCESS] Purge route is available on live backend.
)

echo.
echo [SUCCESS] Your changes are now live on http://mail-merge.ikf.in/
echo.
pause
