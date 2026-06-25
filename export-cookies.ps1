$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

param(
  [ValidateSet("edge", "chrome")]
  [string]$Browser = "edge",
  [string]$Output = ""
)

function Get-YtDlpRunner {
  $candidates = @(
    @{ Label = "yt-dlp"; Command = "yt-dlp"; Prefix = @() },
    @{ Label = "python -m yt_dlp"; Command = "python"; Prefix = @("-m", "yt_dlp") },
    @{ Label = "py -m yt_dlp"; Command = "py"; Prefix = @("-m", "yt_dlp") }
  )

  foreach ($c in $candidates) {
    try {
      & $c.Command @($c.Prefix + @("--version")) | Out-Null
      if ($LASTEXITCODE -eq 0) { return $c }
    } catch {
      continue
    }
  }

  throw "未检测到可用 yt-dlp。请先安装 yt-dlp，或执行: python -m pip install -U yt-dlp"
}

if ([string]::IsNullOrWhiteSpace($Output)) {
  $Output = Join-Path $PSScriptRoot "cookies-$Browser.txt"
}

Write-Host "[SoloSaver] 即将导出 cookies.txt（浏览器: $Browser）" -ForegroundColor Green
Write-Host "[SoloSaver] 请先确认浏览器已登录抖音，并尽量关闭浏览器窗口后再导出。" -ForegroundColor Yellow

$runner = Get-YtDlpRunner
Write-Host "[SoloSaver] 使用下载器: $($runner.Label)" -ForegroundColor Cyan

$args = @()
$args += $runner.Prefix
$args += @(
  "--ignore-config",
  "--cookies-from-browser", $Browser,
  "--cookies", $Output,
  "--skip-download",
  "--simulate",
  "https://www.douyin.com/"
)

try {
  & $runner.Command @args
  if ($LASTEXITCODE -ne 0) {
    throw "导出失败，退出码: $LASTEXITCODE"
  }
  Write-Host "[SoloSaver] 导出成功: $Output" -ForegroundColor Green
} catch {
  Write-Host "[SoloSaver] 导出失败: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "[SoloSaver] 如果提示 DPAPI/数据库占用，请彻底关闭 $Browser 浏览器所有后台进程后重试。" -ForegroundColor Yellow
  exit 1
}
