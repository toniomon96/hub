@echo off
REM Stop the Hub server started by the "Hub Server" scheduled task.
schtasks /End /TN "Hub Server"
taskkill /F /IM node.exe /FI "WINDOWTITLE eq *apps\server\dist\main.js*" 2>nul
echo Hub server stopped.
