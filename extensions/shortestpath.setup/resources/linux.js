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

exports.createProcess = () => ({
	executable: 'sh',
	args: ['-lc', 'if command -v g++ >/dev/null 2>&1; then echo "Using system g++: $(command -v g++)"; else echo "g++ was not found. Install GCC with your Linux distribution package manager, then retry."; exit 1; fi'],
	displayName: 'system g++ check'
});
