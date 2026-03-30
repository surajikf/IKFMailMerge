@echo off
echo Timestamp: %DATE% %TIME% > data\status.txt
echo. >> data\status.txt
echo [PORT 8000 STATUS] >> data\status.txt
netstat -ano | findstr :8000 >> data\status.txt
echo. >> data\status.txt
echo [PYTHON PROCESSES] >> data\status.txt
tasklist | findstr python >> data\status.txt
echo. >> data\status.txt
echo [DIRECTORY LISTING] >> data\status.txt
dir python_bin >> data\status.txt
echo. >> data\status.txt
echo [DONE] >> data\status.txt
