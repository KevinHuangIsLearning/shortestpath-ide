'use strict';

// The Electron main process downloads and installs these MSYS2 MinGW package
// roots (and their repository-declared dependencies) into the IDE data folder.
// No shell, pacman, PowerShell, or system-wide PATH changes are involved.
exports.getMsys2PackageRoots = () => [
	'mingw-w64-x86_64-gcc',
	'mingw-w64-x86_64-clang-tools-extra'
];
