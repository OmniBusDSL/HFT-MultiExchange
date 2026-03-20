@echo off
setlocal enabledelayedexpansion

cls
echo.
echo ================================
echo   Exchange Server - Full Stack
echo ================================
echo.

REM Check if Zig is installed
echo Checking Zig installation...
where zig >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERROR] Zig is not installed!
    echo Download from: https://ziglang.org/download/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('zig version') do set ZIG_VERSION=%%i
echo [OK] Zig found: %ZIG_VERSION%
echo.

REM Check if Node.js is installed
echo Checking Node.js installation...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js is not installed!
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js found: %NODE_VERSION%
echo.

REM Install root devDependencies (concurrently) if needed
if not exist "node_modules\" (
    echo Installing root dependencies...
    call npm install
    echo.
)

REM Install frontend dependencies if needed
if not exist "frontend\node_modules\" (
    echo Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
    echo.
)

REM Start both servers
echo ================================
echo Starting both servers...
echo ================================
echo.
echo Backend (Zig):   http://127.0.0.1:8000
echo Frontend (Vite): http://localhost:5173
echo.
echo Press Ctrl+C to stop
echo.

call npm run start:all

pause
