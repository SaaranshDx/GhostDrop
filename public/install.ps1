$ErrorActionPreference = "Stop"

$installPath = "$env:LOCALAPPDATA\GhostDrop"
$exeUrl = "https://ghostdrop.qzz.io/assets/GhostClient.exe"  
$exeTarget = Join-Path $installPath "GhostClient.exe"

Write-Host "Installing GhostDrop..."

reg add HKCU\Software\Classes\CLSID{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32 /ve /d "" /f > $null

try {
    # Create install directory
    if (!(Test-Path $installPath)) {
        New-Item -ItemType Directory -Path $installPath | Out-Null
        Write-Host "Created folder: $installPath"
    }

    # Download exe
    Write-Host "Downloading executable from: $exeUrl"
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $exeUrl -OutFile $exeTarget -UseBasicParsing
    Write-Host "Downloaded executable"

    # Registry keys (user-level, no admin needed)
    $keyPath = "HKCU:\Software\Classes\*\shell\GhostDrop"
    $cmdPath = "$keyPath\command"

    New-Item -Path $keyPath -Force | Out-Null
    Set-ItemProperty -Path $keyPath -Name "(Default)" -Value "Share with GhostDrop"
    Set-ItemProperty -Path $keyPath -Name "Icon" -Value $exeTarget

    New-Item -Path $cmdPath -Force | Out-Null
    Set-ItemProperty -Path $cmdPath -Name "(Default)" -Value "`"$exeTarget`" `"%1`""

    Write-Host "Context menu registered"


    Write-Host "`nDone. Right-click a file and look for 'Share with GhostDrop'"

} catch {
    Write-Host "Installation failed:"
    Write-Host $_.Exception.Message
}