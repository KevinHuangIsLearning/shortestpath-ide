param(
	[Parameter(Mandatory = $true)]
	[string]$PackagePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PackagePath -PathType Container)) {
	throw "Packaged application was not found at $PackagePath."
}

$dataPath = Join-Path $PackagePath 'data'
$tmpPath = Join-Path $dataPath 'tmp'
New-Item -ItemType Directory -Path $tmpPath -Force | Out-Null

@'
This directory enables ShortestPath IDE portable mode.
Keep the entire data directory when moving or updating the application.
'@ | Set-Content -LiteralPath (Join-Path $dataPath 'portable-mode.txt') -Encoding utf8NoBOM

@'
This marker keeps the portable temporary directory in ZIP archives.
'@ | Set-Content -LiteralPath (Join-Path $tmpPath 'portable-tmp.txt') -Encoding utf8NoBOM

Write-Host "Prepared ShortestPath IDE portable data directory at $dataPath"
