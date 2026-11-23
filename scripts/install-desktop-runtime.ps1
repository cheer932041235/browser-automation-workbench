param([string]$Version='45.2.1')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$runtime=Join-Path $projectRoot 'runtime\desktop-runtime'
$executable=Join-Path $runtime 'my-browser.exe'
if (-not (Test-Path -LiteralPath $executable)) {
    $work=Join-Path $projectRoot 'work\desktop-runtime'
    New-Item -ItemType Directory -Force $work | Out-Null
    $archive=Join-Path $work 'electron-win32-x64.zip'
    Invoke-WebRequest "https://github.com/electron/electron/releases/download/v$Version/electron-v$Version-win32-x64.zip" -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime
    Rename-Item -LiteralPath (Join-Path $runtime 'electron.exe') -NewName 'my-browser.exe'
    Remove-Item -LiteralPath $archive
}
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path $projectRoot '我的浏览器.lnk'))
$shortcut.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments='"'+(Join-Path $projectRoot '打开我的浏览器.vbs')+'"'
$shortcut.WorkingDirectory=$projectRoot
$shortcut.IconLocation=(Join-Path $projectRoot 'packages\browser-desktop\assets\browser.ico')+',0'
$shortcut.Description='我的浏览器：专用会话、后台执行、人工接管'
$shortcut.Save()
Write-Output ('Desktop runtime: '+$executable)
Write-Output ('Launcher: '+(Join-Path $projectRoot '我的浏览器.lnk'))
