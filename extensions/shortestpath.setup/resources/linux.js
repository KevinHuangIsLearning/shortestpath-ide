/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const clangdArchiveName = 'clangd-linux-22.1.6.zip';
const clangdOfficialUrl = `https://github.com/clangd/clangd/releases/download/22.1.6/${clangdArchiveName}`;
const clangdGhfastUrl = `https://ghfast.top/${clangdOfficialUrl}`;

exports.getPortableAssets = ({ source }) => [{
	id: 'clangd 22.1.6',
	urls: [source?.id === 'ghfast' ? clangdGhfastUrl : clangdOfficialUrl],
	archiveName: clangdArchiveName,
	targetDirectory: 'clangd',
	requiredFile: 'clangd_22.1.6/bin/clangd'
}];

// The compiler is not bundled on Linux: the distribution's own GCC is used, and only
// clangd is downloaded. The first-run page cannot answer a sudo password prompt, so
// createProcess below only reports whether g++ exists. Installing it goes through
// createCommand, which the setup command sends to an interactive terminal.
exports.createCommand = () => `if command -v g++ >/dev/null 2>&1; then
	echo "g++ is already available: $(command -v g++)"
	exit 0
fi
if command -v apt-get >/dev/null 2>&1; then
	installer='apt-get install -y g++'
elif command -v dnf >/dev/null 2>&1; then
	installer='dnf install -y gcc-c++'
elif command -v yum >/dev/null 2>&1; then
	installer='yum install -y gcc-c++'
elif command -v pacman >/dev/null 2>&1; then
	installer='pacman -Sy --noconfirm gcc'
elif command -v zypper >/dev/null 2>&1; then
	installer='zypper install -y gcc-c++'
elif command -v apk >/dev/null 2>&1; then
	installer='apk add g++'
else
	echo "No supported package manager was found. Install a C++ compiler that provides g++, then retry."
	exit 1
fi
echo "Installing the system C++ compiler with: $installer"
if [ "$(id -u)" -eq 0 ]; then $installer; else sudo $installer; fi`;

exports.createProcess = () => ({
	executable: 'sh',
	args: ['-lc', 'if command -v g++ >/dev/null 2>&1; then echo "Using system g++: $(command -v g++)"; else echo "g++ was not found. Install GCC with your Linux distribution package manager, then retry."; exit 1; fi'],
	displayName: 'system g++ check'
});
