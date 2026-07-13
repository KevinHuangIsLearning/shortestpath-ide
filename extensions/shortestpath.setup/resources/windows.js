'use strict';

// Downloaded and extracted by the Electron main process. No shell, package
// manager, or system-wide PATH change is involved.
exports.getPortableAssets = () => [
	{
		id: 'gcc',
		urls: [
			'https://mirrors.tuna.tsinghua.edu.cn/github-release/brechtsanders/winlibs_mingw/16.1.0posix-14.0.0-msvcrt-r3/winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64msvcrt-14.0.0-r3.zip',
			'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.1.0posix-14.0.0-msvcrt-r3/winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64msvcrt-14.0.0-r3.zip'
		],
		archiveName: 'winlibs-gcc.zip',
		targetDirectory: 'gcc',
		requiredFile: 'mingw64/bin/g++.exe'
	},
	{
		id: 'clangd',
		urls: [
			'https://mirrors.tuna.tsinghua.edu.cn/github-release/clangd/clangd/22.1.6/clangd-windows-22.1.6.zip',
			'https://github.com/clangd/clangd/releases/download/22.1.6/clangd-windows-22.1.6.zip'
		],
		archiveName: 'clangd-22.1.6.zip',
		targetDirectory: 'clangd',
		requiredFile: 'clangd_22.1.6/bin/clangd.exe'
	}
];
