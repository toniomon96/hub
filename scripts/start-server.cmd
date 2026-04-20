@echo off
REM Starts the Hub webhook server at Windows boot.
REM Registered as a Scheduled Task triggered At startup, RunLevel Highest, as SYSTEM.
REM Logs to logs\server-autostart.log. To stop: schtasks /End /TN "Hub Server".
cd /d C:\Users\tonimontez\hub
if not exist logs mkdir logs
"C:\Program Files\nodejs\node.exe" --no-warnings=ExperimentalWarning apps\server\dist\main.js >> logs\server-autostart.log 2>&1
