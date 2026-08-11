param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (
  Join-Path $PSScriptRoot '..\..'
)

Push-Location $repoRoot

try {
  Write-Host '1. 拉取上游更新'
  git pull --ff-only

  if ($LASTEXITCODE -ne 0) {
    throw 'git pull --ff-only 执行失败。'
  }

  if (-not $SkipInstall) {
    Write-Host '2. 安装或同步依赖'
    pnpm install --frozen-lockfile

    if ($LASTEXITCODE -ne 0) {
      throw 'pnpm install 执行失败。'
    }
  }
  else {
    Write-Host '2. 已跳过依赖安装'
  }

  Write-Host '3. 构建 Chrome 扩展'
  node .\extension\scripts\build.mjs

  if ($LASTEXITCODE -ne 0) {
    throw 'Chrome 扩展构建失败。'
  }

  Write-Host ''
  Write-Host '完成：artifacts\chrome-extension'
}
finally {
  Pop-Location
}
