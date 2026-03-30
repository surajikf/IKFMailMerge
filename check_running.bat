@echo off
echo Checking Port 8000...
netstat -ano | findstr :8000 | findstr LISTENING
echo.
echo Checking Python Processes...
tasklist | findstr python
pause
