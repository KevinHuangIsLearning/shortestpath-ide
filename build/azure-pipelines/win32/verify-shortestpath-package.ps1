param(
	[Parameter(Mandatory = $true)]
	[string]$PackagePath,

	[Parameter(Mandatory = $true)]
	[bool]$IncludeCompiler
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PackagePath -PathType Container)) {
	throw "Packaged application was not found at $PackagePath."
}

$requiredFiles = @(
	'ShortestPath.exe',
	'tools\inno_updater.exe',
	'tools\vcruntime140.dll',
	'resources\app\node_modules.asar.unpacked\node-pty\build\Release\conpty.node',
	'resources\app\node_modules.asar.unpacked\node-pty\build\Release\conpty_console_list.node',
	'resources\app\node_modules.asar.unpacked\node-pty\build\Release\conpty\conpty.dll',
	'resources\app\node_modules.asar.unpacked\node-pty\build\Release\conpty\OpenConsole.exe',
	'resources\app\node_modules.asar.unpacked\node-pty\lib\worker\conoutSocketWorker.js',
	'resources\app\node_modules.asar.unpacked\node-pty\lib\shared\conout.js',
	'resources\app\node_modules.asar.unpacked\node-pty\package.json'
)

foreach ($relativePath in $requiredFiles) {
	$path = Join-Path $PackagePath $relativePath
	if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
		throw "Required Windows package file was not produced: $relativePath"
	}
	if ((Get-Item -LiteralPath $path).Length -eq 0) {
		throw "Required Windows package file is empty: $relativePath"
	}
}

$compilerRelativePath = 'resources\app\resources\oi-defaults\toolchains\winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64ucrt-14.0.0-r3.zip'
$compilerPath = Join-Path $PackagePath $compilerRelativePath
if ($IncludeCompiler) {
	if (-not (Test-Path -LiteralPath $compilerPath -PathType Leaf)) {
		throw "The Include Compiler package is missing WinLibs: $compilerRelativePath"
	}
	if ((Get-Item -LiteralPath $compilerPath).Length -lt 100MB) {
		throw "The packaged WinLibs archive is unexpectedly small: $compilerRelativePath"
	}
} elseif (Test-Path -LiteralPath $compilerPath) {
	throw "The Exclude Compiler package unexpectedly contains WinLibs: $compilerRelativePath"
}

Write-Host "Verified staged Windows package at $PackagePath (IncludeCompiler=$IncludeCompiler)"
