@echo off
REM ============================================================
REM Hub Server - Scheduled Task installer
REM ============================================================
REM Registers the Hub webhook server to autostart at Windows boot.
REM Must be run as Administrator (right-click -> Run as administrator).
REM ============================================================

echo Registering "Hub Server" scheduled task...
schtasks /Create /TN "Hub Server" ^
  /TR "C:\Users\tonimontez\hub\scripts\start-server.cmd" ^
  /SC ONSTART ^
  /RU SYSTEM ^
  /RL HIGHEST ^
  /F

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: schtasks /Create failed. Are you running as Administrator?
    pause
    exit /b 1
)

echo.
echo Starting the task now...
schtasks /Run /TN "Hub Server"

echo.
echo Done. Useful commands:
echo   schtasks /Query /TN "Hub Server" /V /FO LIST   (check status)
echo   schtasks /Run   /TN "Hub Server"               (start now)
echo   schtasks /End   /TN "Hub Server"               (stop)
echo   schtasks /Delete /TN "Hub Server" /F           (unregister)
echo.
echo Server logs: C:\Users\tonimontez\hub\logs\server-autostart.log
pause
