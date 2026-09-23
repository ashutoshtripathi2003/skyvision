@echo off
rem Double-click this file to run SkyVision. Keep this window open while using the app.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, please wait...
  call npm install
)
echo.
echo  SkyVision is running at http://localhost:5173
echo  Close this window to stop it.
echo.
call npx http-server -p 5173 -c-1 -o
