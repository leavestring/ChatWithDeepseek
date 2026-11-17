param(
    [ValidateSet('status', 'install', 'screenshot', 'logs', 'reverse')]
    [string]$Action = 'status',
    [string]$Apk
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$adb = 'D:\Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
    $adb = 'adb'
}

$devices = & $adb devices
$online = $devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' }
if (-not $online) {
    Write-Host 'No authorized Android device found.' -ForegroundColor Yellow
    Write-Host 'Enable Developer options > USB debugging, then allow this computer on the phone.'
    & $adb devices -l
    exit 1
}

switch ($Action) {
    'status' {
        & $adb devices -l
    }
    'install' {
        if (-not $Apk) {
            $version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
            $Apk = Join-Path $root "ChatWithDeepseek-$version-debug.apk"
        }
        if (-not (Test-Path $Apk)) {
            throw "APK not found: $Apk"
        }
        & $adb install -r $Apk
        & $adb shell monkey -p com.chatwithdeepseek.app -c android.intent.category.LAUNCHER 1
    }
    'screenshot' {
        $outDir = Join-Path $root '.preview'
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
        $out = Join-Path $outDir 'real-device.png'
        & cmd.exe /c "`"$adb`" exec-out screencap -p > `"$out`""
        Write-Host "Screenshot saved: $out"
    }
    'logs' {
        & $adb logcat -v time
    }
    'reverse' {
        & $adb reverse tcp:8090 tcp:8090
        Write-Host 'Open http://localhost:8090 in the phone browser for the dev server.'
    }
}
