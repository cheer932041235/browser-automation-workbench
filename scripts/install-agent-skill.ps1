param(
    [string]$Destination = (Join-Path $env:USERPROFILE '.agents\skills\browser-workbench')
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot 'skills\browser-workbench'
$target = [IO.Path]::GetFullPath($Destination)
if ($target.TrimEnd('\','/') -eq $source.TrimEnd('\','/')) {
    throw 'Choose an installation directory outside the source skill folder.'
}
New-Item -ItemType Directory -Force (Join-Path $target 'agents') | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'SKILL.md') -Destination (Join-Path $target 'SKILL.md')
Copy-Item -LiteralPath (Join-Path $source 'agents\openai.yaml') -Destination (Join-Path $target 'agents\openai.yaml')
@{repoRoot=$repoRoot} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'workbench.json') -Encoding utf8
Write-Output ('Installed Browser Workbench skill: ' + $target)
Write-Output 'Reload your agent client to discover the skill. MCP configuration is separate; see the repository README.'
