'use strict';

// The Electron main process extracts bundled clangd, then downloads GCC and its
// repository-declared dependencies into the IDE data folder. No shell, pacman,
// PowerShell, or system-wide PATH changes are involved.
exports.getPortableAssets = () => [
	{
		id: 'clangd 22.1.6',
		urls: [],
		archiveName: 'clangd-windows-22.1.6.zip',
		bundledArchivePath: 'resources/oi-defaults/toolchains/clangd-windows-22.1.6.zip',
		targetDirectory: 'clangd',
		requiredFile: 'clangd_22.1.6/bin/clangd.exe'
	}
];

exports.getMsys2PackageRoots = () => [
	'mingw-w64-x86_64-gcc'
];
