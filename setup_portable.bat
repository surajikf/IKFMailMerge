@echo off
echo ==================================================
echo   IKF MailMerge - Portable Python Setup
echo ==================================================
echo.

if not exist "python_bin\python.exe" (
    echo [ERROR] python_bin folder not found or empty!
    echo Please unzip the Python embeddable package into a folder named 'python_bin'.
    pause
    exit /b
)

cd python_bin

:: 1. Enable site-packages in the .pth file
echo [INFO] Enabling site-packages...
for /f "delims=" %%i in ('dir /b python*._pth') do (
    echo. >> %%i
    echo import site >> %%i
)

:: 2. Download get-pip.py
echo [INFO] Downloading pip...
curl -sS https://bootstrap.pypa.io/get-pip.py -o get-pip.py

:: 3. Install pip
echo [INFO] Installing pip...
python.exe get-pip.py

:: 4. Install dependencies
echo [INFO] Installing IKF MailMerge dependencies...
cd ..
python_bin\python.exe -m pip install -r requirements.txt

echo.
echo [SUCCESS] Portable environment is now ready!
echo You can now run 'run.bat'.
pause
