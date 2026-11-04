@echo off
rem Double-click to play HustleLife on Windows. Keep the window open while you play.
cd /d "%~dp0"
where node >nul 2>nul || (echo HustleLife needs Node 22 or newer. Get the LTS from https://nodejs.org, then double-click this again. & pause & exit /b 1)
node start.mjs %*
if errorlevel 1 pause
