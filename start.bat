@echo off
setlocal
cd /d "%~dp0"

echo [SoloSaver] 启动中...

if not exist node_modules (
  echo [SoloSaver] 未检测到 node_modules，开始安装依赖...
  call npm install
  if errorlevel 1 (
    echo [SoloSaver] npm install 失败，请检查网络或 npm 源配置。
    pause
    exit /b 1
  )
)

echo [SoloSaver] 启动 Electron...
call npm start
if errorlevel 1 (
  echo [SoloSaver] 启动失败，请检查错误日志。
  pause
  exit /b 1
)

endlocal
