'use strict';

exports.getPortableAssets = () => [
	{
		id: 'clangd 22.1.6',
		urls: [],
		archiveName: 'clangd-mac-22.1.6.zip',
		bundledArchivePath: 'resources/oi-defaults/toolchains/clangd-mac-22.1.6.zip',
		targetDirectory: 'clangd',
		requiredFile: 'clangd_22.1.6/bin/clangd'
	}
];

exports.createCommand = ({ stage, locale }) => stage === 'homebrew'
	? `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v brew >/dev/null 2>&1; then
  ${String(locale || '').toLowerCase().startsWith('zh')
		? "installer='/bin/zsh -c \"$(curl -fsSL https://gitee.com/cunkai/HomebrewCN/raw/master/Homebrew.sh)\"'"
		: "installer='/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"'"}
  osascript -e 'on run argv' -e 'tell application "Terminal"' -e 'activate' -e 'do script item 1 of argv' -e 'end tell' -e 'end run' "$installer"
  echo "Homebrew installer opened in Terminal. Complete it there, including any administrator password prompt."
  until command -v brew >/dev/null 2>&1; do sleep 5; done
fi`
	: stage === 'xcode'
		? 'if ! xcode-select -p >/dev/null 2>&1; then xcode-select --install || true; echo "Waiting for Xcode Command Line Tools installation…"; until xcode-select -p >/dev/null 2>&1; do sleep 5; done; fi'
	: 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; brew install gcc';

exports.createProcess = input => ({
	executable: 'zsh',
	args: ['-lc', exports.createCommand(input)],
	displayName: input.stage === 'xcode' ? 'Xcode Command Line Tools' : input.stage === 'homebrew' ? 'Homebrew' : 'GCC toolchain'
});
