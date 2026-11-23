# Attach to the existing Edge. Never launch or stop the browser.
param([int]$Port = 3456)
& node (Join-Path $PSScriptRoot 'start.mjs') --browser edge --port $Port
exit $LASTEXITCODE
