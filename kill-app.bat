@echo off
REM Kill all running processes for the Exchange App (Windows)

echo.
echo 🛑 Killing all app processes...
echo.

REM Kill npm processes
taskkill /F /IM npm.cmd 2>nul
taskkill /F /IM npm.exe 2>nul

REM Kill node processes
taskkill /F /IM node.exe 2>nul

REM Kill Vite dev server
taskkill /F /IM vite.exe 2>nul

REM Kill Zig compiler/server
taskkill /F /IM zig.exe 2>nul

REM Wait a moment
timeout /t 2 /nobreak

echo.
echo ✅ All app processes killed successfully
echo.
pause
