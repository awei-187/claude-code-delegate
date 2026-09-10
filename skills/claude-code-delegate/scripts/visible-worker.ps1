param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$DelegateScript,
    [Parameter(Mandatory = $true)][string]$JobDirectory
)

$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Host.UI.RawUI.WindowTitle = "Claude Code Delegate"
Write-Host "Claude Code delegate started."
Write-Host "Job directory: $JobDirectory"
& $NodePath $DelegateScript worker --job-dir $JobDirectory
$workerExitCode = $LASTEXITCODE
Write-Host ""
Write-Host "Claude Code delegate finished with exit code $workerExitCode."
Write-Host "This window will remain open for inspection."
