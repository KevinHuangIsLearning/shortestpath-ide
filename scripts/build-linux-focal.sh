#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (c) 2026 ShortestPath IDE contributors.
#  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
#---------------------------------------------------------------------------------------------

set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
	echo "Linux packages must be built on a Linux host." >&2
	exit 1
fi

if ! command -v docker > /dev/null; then
	echo "Docker is required to build Linux packages against the Ubuntu 20.04 ABI baseline." >&2
	exit 1
fi

IDE_ROOT="$(cd "$(dirname "$BASH_SOURCE")/.." && pwd)"
NODE_BINARY="$(command -v node)"
NODE_ROOT="$(cd "$(dirname "$NODE_BINARY")/.." && pwd)"
NPM_CACHE="$(npm config get cache)"

mkdir -p "$NPM_CACHE"

docker run --rm --interactive \
	--env CC=clang-15 \
	--env CI=true \
	--env CXX=clang++-15 \
	--env ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
	--env GITHUB_TOKEN \
	--env HOST_GID="$(id -g)" \
	--env HOST_UID="$(id -u)" \
	--env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
	--env VSCODE_ARCH=x64 \
	--env npm_config_arch=x64 \
	--env npm_config_foreground_scripts=true \
	--volume "$IDE_ROOT:/workspace/source" \
	--volume "$NODE_ROOT:/opt/node:ro" \
	--volume "$NPM_CACHE:/npm-cache" \
	--workdir /workspace/source \
	ubuntu:20.04 \
	bash -se <<'CONTAINER_SCRIPT'
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
	binutils \
	build-essential \
	ca-certificates \
	curl \
	fakeroot \
	g++-10 \
	git \
	gnupg \
	libkrb5-dev \
	libxkbfile-dev \
	pkg-config \
	python3

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor --yes --output /etc/apt/keyrings/llvm.gpg
echo 'deb [signed-by=/etc/apt/keyrings/llvm.gpg] https://apt.llvm.org/focal/ llvm-toolchain-focal-15 main' > /etc/apt/sources.list.d/llvm.list
apt-get update
apt-get install -y --no-install-recommends clang-15

# Electron headers need C++20 headers absent from Focal's default GCC 9.
# Also update the host compiler used by build/npm/postinstall.ts.
update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-10 100
update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-10 100

if ! getent group "$HOST_GID" > /dev/null; then
	groupadd --gid "$HOST_GID" shortestpath
fi
if ! getent passwd "$HOST_UID" > /dev/null; then
	useradd --uid "$HOST_UID" --gid "$HOST_GID" --create-home --shell /bin/bash shortestpath
fi

chown "$HOST_UID:$HOST_GID" /workspace
BUILD_USER="$(getent passwd "$HOST_UID" | cut -d: -f1)"
runuser --user "$BUILD_USER" --preserve-environment -- bash -se <<'BUILD_SCRIPT'
set -euo pipefail

export CC=clang-15
export CXX=clang++-15
export HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"
export PATH=/opt/node/bin:$PATH
export npm_config_cache=/npm-cache
export npm_config_devdir="$PWD/.build/node-gyp"

clang-15 --version
clang++-15 --version
node --version

npmrc="$(cat .npmrc)"
trap 'printf "%s" "$npmrc" > .npmrc' EXIT
sed -i '/^build_from_source=/d' .npmrc
# Prepare and patch Electron headers before npm runs native dependency scripts.
npm ci --ignore-scripts
npm_command=ci node build/npm/preinstall.ts
electron_version="$(node -p 'require("fs").readFileSync(".npmrc", "utf8").match(/^target="([^"]+)"/m)[1]')"
printf '#include <node.h>\n' | "$CXX" -std=gnu++20 -fsyntax-only -x c++ -I"$npm_config_devdir/$electron_version/include/node" -
npm ci
printf "%s" "$npmrc" > .npmrc
trap - EXIT

# Rebuild every native module shipped from source against the Focal toolchain.
npm rebuild kerberos node-pty @vscode/policy-watcher @vscode/spdlog @vscode/sqlite3 native-keymap --build-from-source --foreground-scripts

npm run compile-oi-extensions
npm run gulp vscode-linux-x64-min

app="../VSCode-linux-x64"
test -f "$app/shortestpath" || {
	echo "Packaged executable was not found: $app/shortestpath" >&2
	exit 1
}

for entry in \
	"shortestpath.judger/dist/extension.js" \
	"usernamehw.errorlens/dist/extension.js" \
	"shortestpath.setup/out/extension.js" \
	"shortestpath.oj/dist/extension.js" \
	"shortestpath.oj/out/protectedReader.bundle.js" \
	"shortestpath.draw/dist/extension.js" \
	"shortestpath.draw/dist/webview.js" \
	"shortestpath.draw/dist/webview.css" \
	"shortestpath.ojbetter/out/extension.js" \
	"shortestpath.ojbetter/resources/manifest.json" \
	"shortestpath.ojbetter/resources/vendor/atcoder-better.user.js.txt" \
	"shortestpath.ojbetter/resources/vendor/codeforces-better.user.js.txt" \
	"danielpinto8zz6.c-cpp-compile-run/dist/extension.js" \
	"llvm-vs-code-extensions.vscode-clangd/out/bundle.js"; do
	test -f "$app/resources/app/extensions/$entry" || {
		echo "Required extension entry file was not packaged: $entry" >&2
		exit 1
	}
done

node -e "const p=require('node:path'); const r=process.argv[1]; new (require(p.join(r,'out/assets.js')).Assets)(p.join(r,'resources'));" "$app/resources/app/extensions/shortestpath.ojbetter"

mkdir -p artifacts
tar -czf artifacts/ShortestPath-IDE-linux-x64.tar.gz \
	-C .. --transform 's,^VSCode-linux-x64,ShortestPath-IDE-linux-x64,' VSCode-linux-x64

npm run gulp -- vscode-linux-x64-prepare-deb
npm run gulp -- vscode-linux-x64-build-deb

deb="$(find .build/linux/deb/amd64/deb -maxdepth 1 -type f -name '*.deb' -print -quit)"
test -n "$deb" || {
	echo "Linux deb package was not found." >&2
	exit 1
}
version="$(dpkg-deb -f "$deb" Version)"
expected="$(node -p "require('./product.json').shortestPathVersion")"
case "$version" in
	"$expected"-*) ;;
	*)
		echo "Unexpected Debian package version: $version (expected $expected-*)" >&2
		exit 1
		;;
esac
cp "$deb" artifacts/ShortestPath-IDE-linux-x64.deb
BUILD_SCRIPT
CONTAINER_SCRIPT
