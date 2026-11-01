@echo off
cd /d "%~dp0"
netstat -ano | findstr ":8770" | findstr "LISTENING" >nul
if not errorlevel 1 (
 start "TOR Explorer" http://127.0.0.1:8770
 exit /b 0
)
set "TOR_PYTHON=C:\Users\xskyn\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%TOR_PYTHON%" set "TOR_PYTHON=python"

rem First run only: create .env with random database and admin passwords.
if not exist ".env" "%TOR_PYTHON%" backend\server.py --setup

rem Account database (users, roles, reviews) runs in Docker.
docker compose -f docker\docker-compose.yml --env-file .env up -d --wait
if errorlevel 1 (
 echo.
 echo Docker is not running. Open Docker Desktop, then run this file again.
 pause
 exit /b 1
)

start "TOR Explorer" http://127.0.0.1:8770
"%TOR_PYTHON%" backend\server.py --port 8770
pause
