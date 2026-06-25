@echo off
setlocal
cd /d "%~dp0"

set "BROWSER=%~1"
if "%BROWSER%"=="" set "BROWSER=edge"
set "OUTPUT=%~2"

if "%OUTPUT%"=="" (
  powershell -ExecutionPolicy Bypass -File "%~dp0export-cookies.ps1" -Browser %BROWSER%
) else (
  powershell -ExecutionPolicy Bypass -File "%~dp0export-cookies.ps1" -Browser %BROWSER% -Output "%OUTPUT%"
)

if errorlevel 1 (
  echo.
  echo [SoloSaver] cookies 导出失败。
  pause
  exit /b 1
)

echo.
echo [SoloSaver] cookies 导出完成。
pause
endlocal
