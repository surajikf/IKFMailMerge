@echo on
title DEBUGGING BACKEND
set "PY_PATH=python_bin\python.exe"
echo Starting Python... > data\runtime_error.log
"%PY_PATH%" start_server.py >> data\runtime_error.log 2>&1
echo Finished with errorlevel %errorlevel% >> data\runtime_error.log
pause
