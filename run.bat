@echo off
rem Hyperscope launcher: installs the dependencies on the first run, then starts the
rem development server and opens the app in your browser (http://localhost:5173).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
    pause
    exit /b 1
)
if not exist node_modules (
    echo First run: installing dependencies, this takes a minute or two...
    call npm install || (pause & exit /b 1)
)
call npm run dev
pause
