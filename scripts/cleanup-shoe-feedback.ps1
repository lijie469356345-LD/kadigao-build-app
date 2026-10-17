param(
    [int]$DaysOld = 20
)
$ErrorActionPreference = 'Stop'
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$root        = Join-Path $projectRoot 'uploads\shoe-feedback'
$logDir      = Join-Path $scriptDir 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir 'cleanup-shoe-feedback.log'
$cutoff  = (Get-Date).AddDays(-$DaysOld)
$exts    = @('.jpg','.jpeg','.png','.gif','.bmp','.webp')
$files   = @(Get-ChildItem -LiteralPath $root -File -ErrorAction SilentlyContinue | Where-Object { $exts -contains $_.Extension.ToLower() -and $_.LastWriteTime -lt $cutoff })
$deleted = 0; $bytes = 0L
foreach ($f in $files) {
    Remove-Item -LiteralPath $f.FullName -Force
    $deleted++; $bytes += $f.Length
    Add-Content -LiteralPath $logFile -Value ("{0:yyyy-MM-dd HH:mm:ss} DELETED {1} ({2:N1}KB)" -f (Get-Date), $f.Name, ($f.Length/1KB)) -Encoding UTF8
}
Add-Content -LiteralPath $logFile -Value ("{0:yyyy-MM-dd HH:mm:ss} SUMMARY deleted={1} freed={2:N1}MB cutoff={3}" -f (Get-Date), $deleted, ($bytes/1MB), $cutoff.ToString('yyyy-MM-dd HH:mm')) -Encoding UTF8
Write-Output ("deleted={0} freed={1:N1}MB cutoff={2}" -f $deleted, ($bytes/1MB), $cutoff.ToString('yyyy-MM-dd HH:mm'))