$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cleanup   = Join-Path $scriptDir 'cleanup-shoe-feedback.ps1'
$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $cleanup + '"')
$trigger   = New-ScheduledTaskTrigger -Daily -At '06:00'
Register-ScheduledTask -TaskName 'CardiGao-CleanShoeFeedbackImages' -Action $action -Trigger $trigger -Description 'Daily 06:00 cleanup shoe-feedback images older than 20 days' -Force | Out-Null
Write-Output 'scheduled task registered'