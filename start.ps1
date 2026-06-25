$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "[SoloSaver] 启动中..." -ForegroundColor Green

if (-not (Test-Path ".\node_modules")) {
  Write-Host "[SoloSaver] 未检测到 node_modules，开始安装依赖..." -ForegroundColor Yellow
  npm install
}

Write-Host "[SoloSaver] 启动 Electron..." -ForegroundColor Green
npm start
