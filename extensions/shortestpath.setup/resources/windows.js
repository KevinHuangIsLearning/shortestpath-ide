/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

// The Electron main process extracts bundled clangd and downloads one MinGW
// GCC archive into the IDE data folder. No shell, PowerShell, or system-wide
// PATH changes are involved.
const mingwArchiveName = 'mingw64-ucrt-15.2.0-r8.tar.zst';
const mingwOfficialUrl = `https://github.com/redpanda-cpp/mingw-lite/releases/download/15.2.0-r8/${mingwArchiveName}`;
const mingwGhfastUrl = `https://ghfast.top/${mingwOfficialUrl}`;

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
		id: 'MinGW Lite GCC 15.2.0',
		urls: [source?.id === 'ghfast' ? mingwGhfastUrl : mingwOfficialUrl],
		archiveName: mingwArchiveName,
		bundledArchivePath: `resources/oi-defaults/toolchains/${mingwArchiveName}`,
		targetDirectory: 'winlibs',
		requiredFile: 'bin/g++.exe'
	}
];
