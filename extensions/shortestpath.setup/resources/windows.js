'use strict';

// Downloaded and extracted by the Electron main process. No shell, package
// manager, or system-wide PATH change is involved.
exports.getPortableAssets = () => [
	{
		id: 'gcc',
		urls: [
			'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.1.0posix-14.0.0-msvcrt-r3/winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64msvcrt-14.0.0-r3.zip'
		],
		archiveName: 'winlibs-gcc.zip',
		targetDirectory: 'gcc',
		requiredFile: 'mingw64/bin/g++.exe'
	},
	{
		id: 'llvm',
		urls: [
			'https://mirrors.bfsu.edu.cn/github-release/llvm/llvm-project/LatestRelease/clang%2Bllvm-22.1.8-x86_64-pc-windows-msvc.tar.xz',
			'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.8/clang%2Bllvm-22.1.8-x86_64-pc-windows-msvc.tar.xz'
		],
		archiveName: 'llvm-22.1.8.tar.xz',
		archiveFormat: 'tar.xz',
		targetDirectory: 'llvm',
		requiredFile: 'clang+llvm-22.1.8-x86_64-pc-windows-msvc/bin/clangd.exe'
	}
];
