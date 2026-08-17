#!/usr/bin/env bash

set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname "$(dirname "$(realpath "$0")")")
else
	ROOT=$(dirname "$(dirname "$(readlink -f $0)")")
	# If the script is running in Docker using the WSL2 engine, powershell.exe won't exist
	if grep -qi Microsoft /proc/version && type powershell.exe > /dev/null 2>&1; then
		IN_WSL=true
	fi
fi

function code() {
	cd "$ROOT"

	if [[ "$OSTYPE" == "darwin"* ]]; then
		NAME=`node -p "require('./product.json').nameLong"`
		EXE_NAME=`node -p "require('./product.json').nameShort"`
		CODE="./.build/electron/$NAME.app/Contents/MacOS/$EXE_NAME"
	else
		NAME=`node -p "require('./product.json').applicationName"`
		CODE=".build/electron/$NAME"
	fi

	# Get electron, compile, built-in extensions
	if [[ -z "${VSCODE_SKIP_PRELAUNCH}" ]]; then
		node build/lib/preLaunch.ts
	fi

	# Manage built-in extensions
	if [[ "$1" == "--builtin" ]]; then
		exec "$CODE" build/builtin
		return
	fi

	# Configuration
	export NODE_ENV=development
	export VSCODE_DEV=1
	export VSCODE_CLI=1
	export ELECTRON_ENABLE_STACK_DUMPING=1
	# Chromium forwards every Webview console warning to this terminal when
	# ELECTRON_ENABLE_LOGGING is set. Keep that verbose diagnostic stream opt-in.
	if [[ "${VSCODE_ELECTRON_ENABLE_LOGGING:-}" == "1" ]]; then
		export ELECTRON_ENABLE_LOGGING=1
	else
		unset ELECTRON_ENABLE_LOGGING
	fi

	DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
	if [[ "$@" == *"--extensionTestsPath"* ]]; then
		DISABLE_TEST_EXTENSION=""
	fi

	# This fork keeps its configuration and user-installed extensions separate from
	# the stock VS Code installation. Callers can still override either path.
	HAS_USER_DATA_DIR=false
	HAS_EXTENSIONS_DIR=false
	HAS_LOCALE=false
	for arg in "$@"; do
		case "$arg" in
			--user-data-dir|--user-data-dir=*) HAS_USER_DATA_DIR=true ;;
			--extensions-dir|--extensions-dir=*) HAS_EXTENSIONS_DIR=true ;;
			--locale|--locale=*) HAS_LOCALE=true ;;
		esac
	done

	OI_LAUNCH_ARGS=()
	if [[ "$HAS_USER_DATA_DIR" == false ]]; then
		if [[ "$OSTYPE" == "darwin"* ]]; then
			OI_USER_DATA_DIR="${VSCODE_OI_USER_DATA_DIR:-$HOME/Library/Application Support/VSCode-OI}"
		else
			OI_USER_DATA_DIR="${VSCODE_OI_USER_DATA_DIR:-$HOME/.vscode-oi}"
		fi
		OI_LAUNCH_ARGS+=("--user-data-dir=$OI_USER_DATA_DIR")
	fi
	if [[ "$HAS_EXTENSIONS_DIR" == false ]]; then
		if [[ "$OSTYPE" == "darwin"* ]]; then
			OI_EXTENSIONS_DIR="${VSCODE_OI_EXTENSIONS_DIR:-$HOME/.vscode-oi/extensions}"
		else
			OI_EXTENSIONS_DIR="${VSCODE_OI_EXTENSIONS_DIR:-$HOME/.vscode-oi/extensions}"
		fi
		OI_LAUNCH_ARGS+=("--extensions-dir=$OI_EXTENSIONS_DIR")
	fi
	# Development builds do not generate the production NLS metadata. Use the
	# built-in English messages unless a locale was explicitly requested.
	if [[ "$HAS_LOCALE" == false ]]; then
		OI_LAUNCH_ARGS+=("--locale=en")
	fi

	# Launch Code
	exec "$CODE" . $DISABLE_TEST_EXTENSION "${OI_LAUNCH_ARGS[@]}" "$@"
}

function code-wsl()
{
	HOST_IP=$(echo "" | powershell.exe -noprofile -Command "& {(Get-NetIPAddress | Where-Object {\$_.InterfaceAlias -like '*WSL*' -and \$_.AddressFamily -eq 'IPv4'}).IPAddress | Write-Host -NoNewline}")
	export DISPLAY="$HOST_IP:0"

	# in a wsl shell
	ELECTRON="$ROOT/.build/electron/Code - OSS.exe"
	if [ -f "$ELECTRON"  ]; then
		local CWD=$(pwd)
		cd $ROOT
		export WSLENV=ELECTRON_RUN_AS_NODE/w:VSCODE_DEV/w:$WSLENV
		local WSL_EXT_ID="ms-vscode-remote.remote-wsl"
		local WSL_EXT_WLOC=$(echo "" | VSCODE_DEV=1 ELECTRON_RUN_AS_NODE=1 "$ROOT/.build/electron/Code - OSS.exe" "out/cli.js" --locate-extension $WSL_EXT_ID)
		cd $CWD
		if [ -n "$WSL_EXT_WLOC" ]; then
			# replace \r\n with \n in WSL_EXT_WLOC
			local WSL_CODE=$(wslpath -u "${WSL_EXT_WLOC%%[[:cntrl:]]}")/scripts/wslCode-dev.sh
			$WSL_CODE "$ROOT" "$@"
			exit $?
		else
			echo "Remote WSL not installed, trying to run VSCode in WSL."
		fi
	fi
}

if [ "$IN_WSL" == "true" ] && [ -z "$DISPLAY" ]; then
	code-wsl "$@"
elif [ -f /mnt/wslg/versions.txt ]; then
	code --disable-gpu "$@"
elif [ -f /.dockerenv ]; then
	# Workaround for https://bugs.chromium.org/p/chromium/issues/detail?id=1263267
	# Chromium does not release shared memory when streaming scripts
	# which might exhaust the available resources in the container environment
	# leading to failed script loading.
	code --disable-dev-shm-usage "$@"
else
	code "$@"
fi

exit $?
