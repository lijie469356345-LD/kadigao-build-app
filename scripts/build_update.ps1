$dir = "$PSScriptRoot\updates"
$dist = "$PSScriptRoot\dist"
$public = "$PSScriptRoot\public"
$dt = Get-Date -Format 'yyyyMMdd-HHmmss'
$zip = "$dir\update_$dt.zip"

New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host '================================================'
Write-Host '  Cardigao Inspection - Build Update Package'
Write-Host '================================================'
Write-Host ''

Write-Host '[1/3] Packing dist + public ...'
Compress-Archive -Path $dist, $public -DestinationPath $zip -Force
$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "      Package: update_$dt.zip ($size MB)"

Write-Host '[2/3] Writing version info ...'
$json = @{
    version = $dt
    time    = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    files   = @('dist/', 'public/')
    url     = "updates/update_$dt.zip"
} | ConvertTo-Json
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("$dir\version.json", $json, $utf8)
Write-Host '      Version info updated'

Write-Host '[3/3] Done'
Write-Host '================================================'
Write-Host "  Version: $dt"
Write-Host "  Location: updates\update_$dt.zip"
Write-Host '================================================'
Write-Host ''
Write-Host 'Target will auto-update on next launch.'
Write-Host ''
Read-Host -Prompt 'Press Enter to exit'
