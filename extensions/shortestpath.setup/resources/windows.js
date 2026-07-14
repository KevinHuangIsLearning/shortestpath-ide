'use strict';

// The Electron main process extracts bundled clangd and downloads one WinLibs
// GCC archive into the IDE data folder. No shell, PowerShell, or system-wide
// PATH changes are involved.
const winlibsArchiveName = 'winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64ucrt-14.0.0-r3.zip';
const winlibsOfficialUrl = `https://github.com/brechtsanders/winlibs_mingw/releases/download/16.1.0posix-14.0.0-ucrt-r3/${winlibsArchiveName}`;
const winlibsGhfastUrl = `https://ghfast.top/${winlibsOfficialUrl}`;

exports.getPortableAssets = ({ source }) => [
	{
		id: 'clangd 22.1.6',
		urls: [],
		archiveName: 'clangd-windows-22.1.6.zip',
		bundledArchivePath: 'resources/oi-defaults/toolchains/clangd-windows-22.1.6.zip',
		targetDirectory: 'clangd',
		requiredFile: 'clangd_22.1.6/bin/clangd.exe'
	},
	{
		id: 'WinLibs GCC 16.1.0',
		urls: [source?.id === 'ghfast' ? winlibsGhfastUrl : winlibsOfficialUrl],
		archiveName: winlibsArchiveName,
		// This archive is present only in the "Include Compiler" Windows package.
		// The Electron main process falls back to urls when it is absent.
		bundledArchivePath: `resources/oi-defaults/toolchains/${winlibsArchiveName}`,
		targetDirectory: 'winlibs',
		requiredFile: 'mingw64/bin/g++.exe'
	}
];
